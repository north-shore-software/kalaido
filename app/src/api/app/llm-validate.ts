import { ok, type Result } from "neverthrow";
import type {
  LlmProvider,
  LlmRole,
  WorkspaceLlmConfig,
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

const STUB_DELAY_MS = 400;

export function validateKey(
  _input: ValidateKeyInput,
): Promise<Result<ValidateResult, Error>> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(ok({ ok: true })), STUB_DELAY_MS);
  });
}

export function validateWorkspaceLlmConfig(
  config: WorkspaceLlmConfig,
): Promise<Result<ValidateResult, Error>> {
  return validateKey({
    provider: config.provider,
    apiKey: config.apiKey ?? "",
    defaultModel: config.defaultModel,
    roleModels: config.roleModels,
  });
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
