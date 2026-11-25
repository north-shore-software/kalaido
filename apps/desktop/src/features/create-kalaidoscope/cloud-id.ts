import type { CloudIdAvailability } from "@kalaido/client/cloud/user";
import {
  type LlmProvider,
  type LlmRole,
  ollamaWorkspaceLlmConfig,
  type WorkspaceLlmConfig,
} from "@kalaido/client/kalaidoscope/llm-config";
import type { StorageType } from "./components/storage-option-cards";

const CLOUD_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const FALLBACK_CLOUD_ID_LENGTH = 8;

export const CLOUD_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const CLOUD_ID_CHECK_DELAY_MS = 300;

export type CloudIdCheck = { id: string } & (
  | CloudIdAvailability
  | { available: null; suggestion?: undefined }
);

export interface CloudIdStatus {
  text: string;
  tone: "muted" | "error";
}

export interface SetupFields {
  name: string;
  icon?: string;
  storageChoice: StorageType | null;
  cloudIdChoice: string | null;
  llmProvider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  roleModels: Partial<Record<LlmRole, string>>;
}

export const INITIAL_SETUP_FIELDS: SetupFields = {
  name: "",
  storageChoice: null,
  cloudIdChoice: null,
  llmProvider: "ollama",
  apiKey: "",
  defaultModel: "",
  roleModels: {},
};

export function randomFallbackCloudId(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(FALLBACK_CLOUD_ID_LENGTH),
  );
  const suffix = Array.from(
    bytes,
    (b) => CLOUD_ID_ALPHABET[b % CLOUD_ID_ALPHABET.length],
  ).join("");
  return `kl-${suffix}`;
}

export function deriveCloudId(name: string, fallback: string): string {
  if (!name.trim()) return "";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? slug : fallback;
}

export function deriveCloudIdState({
  fields,
  fallbackCloudId,
  storage,
  signedIn,
  idCheck,
  idChecking,
}: {
  fields: SetupFields;
  fallbackCloudId: string;
  storage: StorageType;
  signedIn: boolean;
  idCheck: CloudIdCheck | null;
  idChecking: boolean;
}) {
  const derivedCloudId = deriveCloudId(fields.name, fallbackCloudId);
  const idIsManual = fields.cloudIdChoice !== null;
  const candidateId = fields.cloudIdChoice ?? derivedCloudId;
  const idIsValid = CLOUD_ID_RE.test(candidateId);
  const checked = idCheck?.id === candidateId ? idCheck : null;
  const cloudId =
    !idIsManual && checked?.available === false && checked.suggestion
      ? checked.suggestion
      : candidateId;
  const idTaken =
    checked?.available === false && (idIsManual || !checked.suggestion);
  const cloudChecksApply = storage === "cloud" && signedIn;
  const idReady =
    !cloudChecksApply || (idIsValid && !idChecking && !!checked && !idTaken);
  const byokSelected =
    storage === "local_file" && fields.llmProvider === "gemini";
  const needsSignIn = storage === "cloud" && !signedIn;
  const canCreate =
    !!fields.name.trim() &&
    (storage === "local_file" || (!!cloudId.trim() && idReady)) &&
    (!byokSelected || (!!fields.apiKey.trim() && !!fields.defaultModel.trim()));

  return {
    candidateId,
    idIsValid,
    checked,
    cloudId,
    idTaken,
    cloudChecksApply,
    idReady,
    byokSelected,
    needsSignIn,
    canCreate,
    submitLabel: needsSignIn ? "Sign in & create" : "Create Kalaidoscope",
    status: describeCloudIdStatus({
      cloudId,
      candidateId,
      idIsValid,
      cloudChecksApply,
      idChecking,
      checked,
      idTaken,
    }),
  };
}

export function describeCloudIdStatus({
  cloudId,
  candidateId,
  idIsValid,
  cloudChecksApply,
  idChecking,
  checked,
  idTaken,
}: {
  cloudId: string;
  candidateId: string;
  idIsValid: boolean;
  cloudChecksApply: boolean;
  idChecking: boolean;
  checked: CloudIdCheck | null;
  idTaken: boolean;
}): CloudIdStatus | null {
  if (!cloudId) return null;
  if (!idIsValid) {
    return {
      text: "Lowercase letters, numbers and dashes only; 2 to 63 characters, starting with a letter or number.",
      tone: "error",
    };
  }
  if (!cloudChecksApply) return null;
  if (idChecking || !checked) {
    return { text: "Checking availability…", tone: "muted" };
  }
  if (idTaken) return { text: "This ID is taken.", tone: "error" };
  if (checked.available === null) {
    return {
      text: "Couldn't check availability. It will be checked when you create.",
      tone: "muted",
    };
  }
  if (cloudId !== candidateId) {
    return {
      text: `“${candidateId}” is taken, so this one was generated instead. You can change it.`,
      tone: "muted",
    };
  }
  return { text: "Available. IDs can't be changed later.", tone: "muted" };
}

export function buildSetupLlmConfig(
  storage: StorageType,
  fields: SetupFields,
): WorkspaceLlmConfig | undefined {
  if (storage !== "local_file") return undefined;
  if (fields.llmProvider === "ollama") return ollamaWorkspaceLlmConfig();
  return {
    provider: "gemini",
    apiKey: fields.apiKey.trim(),
    defaultModel: fields.defaultModel.trim(),
    roleModels: { ...fields.roleModels },
  };
}

export function findMissingSetupFields({
  fields,
  storage,
  cloudId,
  byokSelected,
}: {
  fields: SetupFields;
  storage: StorageType;
  cloudId: string;
  byokSelected: boolean;
}): ("name" | "cloudId" | "apiKey" | "model")[] {
  const missing: ("name" | "cloudId" | "apiKey" | "model")[] = [];
  if (!fields.name.trim()) missing.push("name");
  if (storage === "cloud" && !cloudId) missing.push("cloudId");
  if (byokSelected && !fields.apiKey.trim()) missing.push("apiKey");
  if (byokSelected && !fields.defaultModel.trim()) missing.push("model");
  return missing;
}
