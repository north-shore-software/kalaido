import type { Result } from "neverthrow";
import { ClientResponseError } from "pocketbase";
import { withActiveClient } from "./_active";
import type { KalaidoscopeConfigResponse } from "./types";

export const LLM_PROVIDERS = ["ollama", "gemini"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_ROLES = [
  "chat",
  "refinement",
  "colour",
  "distill",
  "snapshot",
] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

export const LLM_ROLE_LABELS: Record<LlmRole, string> = {
  chat: "Chat",
  refinement: "Refinement",
  colour: "Colour scoring",
  distill: "Lens distillation",
  snapshot: "Projections & reflections",
};

/**
 * The local model Kalaido is tuned for. The backend seeds the same name for
 * every role of the local model set and preloads it at boot
 * (`kalaidoscope/llm/registry.go`, `internal/ollama/ollama.go`), so a workspace
 * that records anything else is choosing to differ from the default.
 */
export const RECOMMENDED_MODEL = "gemma4";

export const GEMINI_SUGGESTED_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
] as const;

export interface WorkspaceLlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  defaultModel: string;
  roleModels?: Partial<Record<LlmRole, string>>;
}

/**
 * The config a workspace records for local Ollama. It is written explicitly
 * rather than left blank, because an unwritten provider looks the same as a
 * workspace that predates provider config. The model can't be omitted: the
 * backend rejects a configured provider with no model. So every role is pinned
 * to the recommended model, which is what the local model set already
 * resolves to.
 */
export function ollamaWorkspaceLlmConfig(): WorkspaceLlmConfig {
  return {
    provider: "ollama",
    defaultModel: RECOMMENDED_MODEL,
    roleModels: Object.fromEntries(
      LLM_ROLES.map((role) => [role, RECOMMENDED_MODEL]),
    ),
  };
}

export function roleModelsPayload(
  roleModels: Partial<Record<LlmRole, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of LLM_ROLES) {
    const model = roleModels?.[role]?.trim();
    if (model) out[role] = model;
  }
  return out;
}

/**
 * The open workspace's provider config as the app can see it. The key itself is
 * write-only (the backend hides `api_key` from app users); `has_api_key` is the
 * backend's stand-in for it.
 */
export interface StoredWorkspaceLlmConfig {
  provider: LlmProvider | null;
  defaultModel: string;
  roleModels: Partial<Record<LlmRole, string>>;
  hasApiKey: boolean;
}

function isProvider(value: unknown): value is LlmProvider {
  return LLM_PROVIDERS.includes(value as LlmProvider);
}

export function readWorkspaceLlmConfig(): Promise<
  Result<StoredWorkspaceLlmConfig, Error>
> {
  return withActiveClient(async (client) => {
    const record = await client
      .collection("kalaidoscope_config")
      .getFirstListItem<KalaidoscopeConfigResponse & { has_api_key?: boolean }>(
        "",
        { requestKey: null },
      );
    const roleModels: Partial<Record<LlmRole, string>> = {};
    const stored = record.role_models;
    if (stored && typeof stored === "object") {
      for (const role of LLM_ROLES) {
        const model = (stored as Record<string, unknown>)[role];
        if (typeof model === "string" && model) roleModels[role] = model;
      }
    }
    return {
      provider: isProvider(record.provider) ? record.provider : null,
      defaultModel: record.default_model ?? "",
      roleModels,
      hasApiKey: record.has_api_key === true,
    };
  });
}

/**
 * Writes the provider config to the open workspace. The backend validates the
 * key and models live before saving, and switches generation over with no
 * restart.
 *
 * `apiKey` left undefined keeps the stored key, since the app can't read it
 * back to resend it. Ollama always clears it: a local provider has no credential,
 * and a stale key shouldn't outlive the switch.
 */
export function writeWorkspaceLlmConfig(
  config: WorkspaceLlmConfig,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    const collection = client.collection("kalaidoscope_config");
    const record = await collection.getFirstListItem("");
    const apiKey = config.provider === "ollama" ? "" : config.apiKey;
    try {
      await collection.update(record.id, {
        provider: config.provider,
        ...(apiKey !== undefined && { api_key: apiKey }),
        default_model: config.defaultModel.trim(),
        role_models: roleModelsPayload(config.roleModels),
      });
    } catch (e) {
      throw fieldError(e) ?? e;
    }
  });
}

/**
 * The config hook keys a failed provider check on `api_key` and a missing model
 * on `default_model`. Surface that message on its own, rather than the
 * `field: message` join the generic PocketBase error handling produces.
 */
function fieldError(e: unknown): Error | null {
  if (!(e instanceof ClientResponseError)) return null;
  const data = e.response?.data as
    | Record<string, { message?: string }>
    | undefined;
  const message = data?.api_key?.message ?? data?.default_model?.message;
  return message ? new Error(message) : null;
}
