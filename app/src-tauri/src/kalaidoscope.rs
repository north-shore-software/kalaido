use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use std::collections::HashMap;

use crate::sidecar::spawn::{SidecarSpec, spawn_sidecar};
use crate::sidecar::stop::{stop_sidecar, stop_sidecar_blocking};
use crate::sidecar::types::{SidecarInstance, SidecarStatus};

pub(crate) struct LocalInstanceData {
    pub sidecar: SidecarInstance,
    pub auth_token: Option<String>,
    pub port: u16,
}

/// One entry per kalaidoscope id. `Starting` reserves the id while a start is
/// in flight (there is no child process to manage yet) — concurrent starts for
/// the same id must be no-ops: two sidecars on one data dir each rotate the
/// seeded user's tokenKey on seed, invalidating the other's captured token.
pub(crate) enum InstanceEntry {
    Starting,
    Running(LocalInstanceData),
}

#[derive(Default)]
pub(crate) struct KalaidoscopeState {
    pub instances: Mutex<HashMap<String, InstanceEntry>>,
}

#[tauri::command]
pub(crate) fn get_local_kalaidoscope_auth_token(
    kalaidoscope_id: String,
    app: AppHandle,
) -> Result<String, String> {
    if let Some(kal_state) = app.try_state::<KalaidoscopeState>() {
        match kal_state.instances.lock().unwrap().get(&kalaidoscope_id) {
            Some(InstanceEntry::Starting) => Err(format!(
                "Local kalaidoscope {} is still starting",
                kalaidoscope_id
            )),
            Some(InstanceEntry::Running(instance)) => instance
                .auth_token
                .clone()
                .ok_or_else(|| "No local token available for this ID".to_string()),
            None => Err(format!(
                "Local kalaidoscope {} not running",
                kalaidoscope_id
            )),
        }
    } else {
        Err("No local token available".to_string())
    }
}

#[tauri::command]
pub(crate) fn get_local_kalaidoscope_status(
    kalaidoscope_id: String,
    app: AppHandle,
) -> SidecarStatus {
    if let Some(kal_state) = app.try_state::<KalaidoscopeState>() {
        match kal_state.instances.lock().unwrap().get(&kalaidoscope_id) {
            Some(InstanceEntry::Starting) => {
                return SidecarStatus::new("starting", Some(&kalaidoscope_id), None);
            }
            Some(InstanceEntry::Running(instance)) => {
                return instance.sidecar.status.lock().unwrap().clone();
            }
            None => {}
        }
    }
    SidecarStatus::new("stopped", Some(&kalaidoscope_id), None)
}

pub(crate) fn init_kalaidoscope_data(data_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    // Create an empty pb_data directory to serve as a marker for a valid kalaidoscope
    std::fs::create_dir_all(data_dir.join("pb_data")).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct KalaidoscopeCreationDetails {
    pub path: String,
}

#[tauri::command]
pub(crate) fn create_local_kalaidoscope(
    kalaidoscope_id: String,
    data_dir: Option<String>,
    app: AppHandle,
) -> Result<KalaidoscopeCreationDetails, String> {
    let path = match data_dir {
        Some(p) => PathBuf::from(p).join(&kalaidoscope_id),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("kalaidoscopes")
            .join(&kalaidoscope_id),
    };

    init_kalaidoscope_data(&path)?;

    Ok(KalaidoscopeCreationDetails {
        path: path.to_string_lossy().into_owned(),
    })
}

async fn check_health(client: &reqwest::Client, port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");

    match client.get(&url).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

async fn refresh_user_token(token: &str, port: u16) -> Result<String, String> {
    #[derive(Deserialize)]
    struct AuthRefreshResponse {
        token: String,
    }

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/api/collections/users/auth-refresh");

    let res = client
        .post(&url)
        .header("Authorization", token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!(
            "Failed to refresh local user token: {}",
            res.status()
        ));
    }

    let auth_data: AuthRefreshResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(auth_data.token)
}

#[tauri::command]
pub(crate) async fn start_local_kalaidoscope(
    data_dir: String,
    app: AppHandle,
) -> Result<(), String> {
    let data_dir_path = PathBuf::from(&data_dir);

    if !data_dir_path.exists() {
        return Err(format!(
            "Kalaidoscope data directory not found at '{}'.",
            data_dir_path.display()
        ));
    }

    if !data_dir_path.join("pb_data").is_dir() {
        return Err(format!(
            "Directory '{}' does not appear to be a valid Kalaidoscope data directory (missing pb_data).",
            data_dir_path.display()
        ));
    }

    let id_for_sidecar = data_dir_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    // No-op if this kalaidoscope is already running or another start for it
    // is in flight (e.g. React StrictMode replaying the start effect). A
    // stopped/crashed remnant entry does not block a restart.
    {
        let kal_state = app.state::<KalaidoscopeState>();
        let mut instances = kal_state.instances.lock().unwrap();
        match instances.get(&id_for_sidecar) {
            Some(InstanceEntry::Starting) => return Ok(()),
            Some(InstanceEntry::Running(existing))
                if existing.sidecar.status.lock().unwrap().phase == "running" =>
            {
                return Ok(());
            }
            Some(InstanceEntry::Running(_)) | None => {}
        }
        instances.insert(id_for_sidecar.clone(), InstanceEntry::Starting);
    }

    let result = spawn_and_register(&app, &data_dir_path, &id_for_sidecar).await;

    if result.is_err() {
        app.state::<KalaidoscopeState>()
            .instances
            .lock()
            .unwrap()
            .remove(&id_for_sidecar);
    }

    result
}

async fn spawn_and_register(
    app: &AppHandle,
    data_dir_path: &Path,
    id_for_sidecar: &str,
) -> Result<(), String> {
    let dir_str = data_dir_path.to_str().ok_or("non-UTF-8 path")?.to_string();

    let client = reqwest::Client::new();
    let health_client = client.clone();

    let sidecar_instance = spawn_sidecar(
        app,
        id_for_sidecar,
        "sidecar:pocketbase:status",
        SidecarSpec {
            sidecar_name: "pocketbase",
            args: vec![
                "serve".to_string(),
                "--http=127.0.0.1:0".to_string(),
                "--dir".to_string(),
                dir_str,
                "--dev".to_string(),
            ],
            envs: vec![],
            capture_filter: Some("KALAIDO_"),
        },
        move |captured_lines| {
            let client = health_client.clone();
            async move {
                let mut port = None;
                {
                    let lines = captured_lines.lock().unwrap();
                    for line in lines.iter() {
                        if let Some(p_str) = line.strip_prefix("PORT=")
                            && let Ok(p) = p_str.parse::<u16>()
                        {
                            port = Some(p);
                            break;
                        }
                    }
                }
                if let Some(p) = port {
                    check_health(&client, p).await
                } else {
                    false
                }
            }
        },
    )
    .await?;

    let (initial_token, port) = {
        let lines = sidecar_instance.captured_lines.lock().unwrap();
        let mut t = None;
        let mut p = None;
        for line in lines.iter() {
            if let Some(t_str) = line.strip_prefix("USER_TOKEN=") {
                t = Some(t_str.to_string());
            } else if let Some(p_str) = line.strip_prefix("PORT=") {
                p = p_str.parse::<u16>().ok();
            }
        }
        (t, p)
    };

    let initial_token = initial_token.ok_or("No token captured from sidecar")?;
    let port = port.ok_or("No port captured from sidecar")?;

    let new_token = refresh_user_token(&initial_token, port).await?;

    let kal_state = app.state::<KalaidoscopeState>();
    kal_state.instances.lock().unwrap().insert(
        id_for_sidecar.to_string(),
        InstanceEntry::Running(LocalInstanceData {
            sidecar: sidecar_instance,
            auth_token: Some(new_token),
            port,
        }),
    );

    Ok(())
}

#[tauri::command]
pub(crate) async fn stop_local_kalaidoscope(
    kalaidoscope_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let instance_data = {
        let kal_state = app.state::<KalaidoscopeState>();
        let mut instances = kal_state.instances.lock().unwrap();
        if matches!(
            instances.get(&kalaidoscope_id),
            Some(InstanceEntry::Starting)
        ) {
            return Err(format!(
                "Local kalaidoscope {} is still starting; wait for it to be running before stopping",
                kalaidoscope_id
            ));
        }
        match instances.remove(&kalaidoscope_id) {
            Some(InstanceEntry::Running(data)) => Some(data),
            _ => None,
        }
    };

    if let Some(instance) = instance_data {
        *instance.sidecar.status.lock().unwrap() =
            SidecarStatus::new("stopping", Some(&kalaidoscope_id), None);
        let _ = app.emit(
            "sidecar:pocketbase:status",
            instance.sidecar.status.lock().unwrap().clone(),
        );

        stop_sidecar(instance.sidecar.handle, Some(instance.port)).await;

        // Final stopped event emitted by supervisor cb
    }

    Ok(())
}

pub(crate) fn stop_all_kalaidoscopes_on_exit(app: &AppHandle) {
    if let Some(kal_state) = app.try_state::<KalaidoscopeState>() {
        let mut instances = kal_state.instances.lock().unwrap();
        for (_, entry) in instances.drain() {
            // `Starting` entries have no child handle yet; the app is exiting
            // so the in-flight start is abandoned.
            if let InstanceEntry::Running(instance) = entry {
                stop_sidecar_blocking(instance.sidecar.handle);
            }
        }
    }
}
