import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

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

export function writeWorkspaceLlmConfig(
  config: WorkspaceLlmConfig,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    const collection = client.collection("kalaidoscope_config");
    const record = await collection.getFirstListItem("");
    await collection.update(record.id, {
      provider: config.provider,
      api_key: config.apiKey ?? "",
      default_model: config.defaultModel.trim(),
      role_models: roleModelsPayload(config.roleModels),
    });
  });
}
