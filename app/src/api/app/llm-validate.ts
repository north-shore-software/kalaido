import { invoke } from "@tauri-apps/api/core";
import { ok, type Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";
import {
  LLM_ROLES,
  type LlmProvider,
  type LlmRole,
  type WorkspaceLlmConfig,
} from "@/api/kalaidoscope/llm-config";

export type ValidateErrorKind = "auth" | "quota" | "transient" | "other";

export interface ValidateResult {
  ok: boolean;
  kind?: ValidateErrorKind;
  provider?: LlmProvider;
  model?: string;
  detail?: string;
}

export interface ValidateKeyInput {
  provider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  roleModels?: Partial<Record<LlmRole, string>>;
}

/**
 * Checks a credential against the provider itself, before anything is created.
 *
 * This runs through a Rust command rather than the workspace backend because
 * during setup the sidecar — and therefore the config hook that normally
 * validates on write — does not exist yet. Catching a bad key here is what
 * stops the workspace being created and then rolled back out from under the
 * user (see `startAndConfigure` in `features/create-kalaidoscope/actions.ts`).
 *
 * A rejected key resolves as `ok({ ok: false, kind })`; an `err` means the
 * check itself could not run.
 */
export function validateKey(
  input: ValidateKeyInput,
): Promise<Result<ValidateResult, Error>> {
  return tauriResult(
    invoke<ValidateResult>("validate_llm_key", {
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.defaultModel,
    }),
  );
}

/**
 * Every distinct model a config references, default first and then role
 * overrides in role order. Mirrors `WorkspaceConfig.Models()` on the backend,
 * so the model a failure is reported against is the same one either side.
 */
function configuredModels(config: WorkspaceLlmConfig): string[] {
  const models = [
    config.defaultModel,
    ...LLM_ROLES.map((r) => config.roleModels?.[r]),
  ]
    .map((m) => m?.trim())
    .filter((m): m is string => !!m);

  return [...new Set(models)];
}

/**
 * Validates every model the config references, not just the default one.
 *
 * The backend's config hook validates the whole set on write, so checking only
 * the default model here would let a bad per-role override through to exactly
 * the failure this pre-flight exists to prevent. Runs concurrently and reports
 * the earliest-listed failure, so the message stays stable across runs.
 */
export async function validateWorkspaceLlmConfig(
  config: WorkspaceLlmConfig,
): Promise<Result<ValidateResult, Error>> {
  const models = configuredModels(config);
  if (models.length === 0) return ok({ ok: true });

  const results = await Promise.all(
    models.map((defaultModel) =>
      validateKey({
        provider: config.provider,
        apiKey: config.apiKey ?? "",
        defaultModel,
      }),
    ),
  );

  for (const result of results) {
    if (result.isErr() || !result.value.ok) return result;
  }

  return ok({ ok: true });
}

export function validationMessage(result: ValidateResult): string {
  if (result.detail) return result.detail;
  switch (result.kind) {
    case "auth":
      return "That API key was rejected by the provider.";
    case "quota":
      return "The provider reported that this key is out of quota.";
    case "transient":
      return "Couldn't reach the provider. Check your connection and try again.";
    default:
      return "The provider couldn't be validated with these settings.";
  }
}
