//! Provider checks that have to run BEFORE a workspace exists.
//!
//! During `/kalaidoscope/setup` the workspace's PocketBase sidecar has not been
//! spawned yet, so the app cannot reach its `/api/ollama/status` route or its
//! config-validation hook — the two places these checks normally live. Both are
//! reimplemented here against the same upstream endpoints so the setup form can
//! answer "will AI work?" and "is this key good?" with nothing running.
//!
//! Doing it from Rust rather than the webview also sidesteps the app's CSP,
//! whose `connect-src` allowlist covers loopback only.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Ollama's default listen address. Matches the Go sidecar's fallback in
/// `kalaidoscope/internal/ollama/ollama.go`.
const OLLAMA_BASE: &str = "http://127.0.0.1:11434";

/// Short enough that a wrong answer costs the user no real time — this runs on
/// every toggle to the Ollama provider.
const OLLAMA_TIMEOUT: Duration = Duration::from_secs(3);

/// Bounds one validation call. Generous next to the Ollama probe because a
/// hosted provider's first token can be slow, but still short of the 20s the
/// backend allows for a whole multi-model pass.
const VALIDATE_TIMEOUT: Duration = Duration::from_secs(15);

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Deliberately trivial: this is a reachability and credential check, not a
/// capability test, and every call is billed. Mirrors the backend's
/// `validationPrompt` in `internal/config/validate.go`.
const VALIDATE_PROMPT: &str = "ping";

#[derive(Serialize)]
pub(crate) struct OllamaStatus {
    reachable: bool,
}

/// Mirrors `llm.ErrorKind` in `kalaidoscope/llm/errors.go` so the UI can tell a
/// bad key apart from a provider that is merely down.
#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ValidateErrorKind {
    Auth,
    Quota,
    Transient,
    Other,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidateResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<ValidateErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

/// Maps an HTTP status onto a kind, matching `llm.ClassifyStatus`.
fn classify_status(code: u16) -> ValidateErrorKind {
    match code {
        401 | 403 => ValidateErrorKind::Auth,
        429 => ValidateErrorKind::Quota,
        c if c >= 500 => ValidateErrorKind::Transient,
        _ => ValidateErrorKind::Other,
    }
}

/// Is Ollama serving on the local machine?
///
/// Never fails: an unreachable host, a refused connection and a timeout are all
/// the same answer to the user ("not running"), and an `Err` here would force
/// the caller to render an error state for the ordinary case of Ollama simply
/// not being installed.
#[tauri::command]
pub(crate) async fn check_ollama_status() -> Result<OllamaStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(OLLAMA_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let reachable = client
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success());

    Ok(OllamaStatus { reachable })
}

/// Checks a provider credential against the provider itself.
///
/// Goes through the same endpoint real generation uses, so an invalid key, a
/// model the key cannot reach and an exhausted quota all surface exactly as
/// they would in production. Returning `Ok(ValidateResult { ok: false, .. })`
/// rather than `Err` keeps a rejected key — an expected outcome — distinct from
/// the IPC call itself failing.
#[tauri::command]
pub(crate) async fn validate_llm_key(
    provider: String,
    api_key: String,
    model: String,
) -> Result<ValidateResult, String> {
    match provider.as_str() {
        // A local service needs no credential, matching `llm::RequiresCredential`.
        // Reachability is reported separately by `check_ollama_status`.
        "ollama" => Ok(ok_result()),
        "gemini" => Ok(validate_gemini(&api_key, &model).await),
        other => Ok(failure(
            ValidateErrorKind::Other,
            &provider,
            &model,
            format!("Unknown provider '{other}'."),
        )),
    }
}

async fn validate_gemini(api_key: &str, model: &str) -> ValidateResult {
    if api_key.trim().is_empty() {
        return failure(
            ValidateErrorKind::Auth,
            "gemini",
            model,
            "An API key is required.".to_string(),
        );
    }

    let client = match reqwest::Client::builder().timeout(VALIDATE_TIMEOUT).build() {
        Ok(c) => c,
        Err(e) => {
            return failure(ValidateErrorKind::Transient, "gemini", model, e.to_string());
        }
    };

    let url = format!("{GEMINI_BASE}/models/{model}:generateContent");
    let body = serde_json::json!({
        "contents": [{ "parts": [{ "text": VALIDATE_PROMPT }] }]
    });

    let res = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        // No status to classify: DNS failure, no route, TLS problem, timeout.
        Err(e) => return failure(ValidateErrorKind::Transient, "gemini", model, e.to_string()),
    };

    let status = res.status();
    if status.is_success() {
        return ok_result();
    }

    let body = res.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<GeminiErrorEnvelope>(&body)
        .ok()
        .and_then(|e| e.error);

    let detail = parsed
        .as_ref()
        .and_then(|e| e.message.clone())
        .unwrap_or_else(|| format!("Gemini rejected the request (HTTP {status})."));

    failure(
        classify_gemini(status.as_u16(), parsed.as_ref()),
        "gemini",
        model,
        detail,
    )
}

/// The envelope Gemini returns on failure.
#[derive(Deserialize)]
struct GeminiErrorEnvelope {
    error: Option<GeminiError>,
}

#[derive(Deserialize)]
struct GeminiError {
    message: Option<String>,
    status: Option<String>,
    #[serde(default)]
    details: Vec<GeminiErrorDetail>,
}

#[derive(Deserialize)]
struct GeminiErrorDetail {
    reason: Option<String>,
}

/// Maps a failed Gemini response onto a kind, mirroring `classify` in
/// `kalaidoscope/gemini/errors.go`.
///
/// The status line alone is not enough: Gemini reports an invalid or revoked
/// API key as HTTP 400 INVALID_ARGUMENT with an API_KEY_INVALID reason rather
/// than a 401, so classifying on status would file a dead credential under
/// "other" and lose the one distinction the user actually needs here. The body
/// decides where it can, and status is the fallback.
fn classify_gemini(status: u16, error: Option<&GeminiError>) -> ValidateErrorKind {
    if let Some(error) = error {
        let credential_rejected = error.details.iter().any(|detail| {
            matches!(
                detail.reason.as_deref(),
                Some(
                    "API_KEY_INVALID"
                        | "API_KEY_SERVICE_BLOCKED"
                        | "ACCOUNT_STATE_INVALID"
                        | "SERVICE_DISABLED"
                )
            )
        });
        if credential_rejected {
            return ValidateErrorKind::Auth;
        }

        match error.status.as_deref() {
            Some("UNAUTHENTICATED" | "PERMISSION_DENIED") => return ValidateErrorKind::Auth,
            Some("RESOURCE_EXHAUSTED") => return ValidateErrorKind::Quota,
            Some("UNAVAILABLE" | "DEADLINE_EXCEEDED" | "INTERNAL") => {
                return ValidateErrorKind::Transient;
            }
            _ => {}
        }
    }

    classify_status(status)
}

fn ok_result() -> ValidateResult {
    ValidateResult {
        ok: true,
        kind: None,
        provider: None,
        model: None,
        detail: None,
    }
}

fn failure(kind: ValidateErrorKind, provider: &str, model: &str, detail: String) -> ValidateResult {
    ValidateResult {
        ok: false,
        kind: Some(kind),
        provider: Some(provider.to_string()),
        model: Some(model.to_string()),
        detail: Some(detail),
    }
}
