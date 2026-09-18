import { startTransition, useId, useState, useTransition } from "react";
import {
  validateWorkspaceLlmConfig,
  validationMessage,
} from "@/api/app/llm-validate.ts";
import {
  LLM_ROLES,
  type LlmProvider,
  type LlmRole,
  RECOMMENDED_MODEL,
  type WorkspaceLlmConfig,
} from "@/api/kalaidoscope/llm-config.ts";
import {
  RequiredPill,
  requiredHighlightClass,
  useRequiredHighlights,
} from "@/components/kalaido";
import { PageBackButton } from "@/components/layout/page-back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createKalaidoscope } from "@/features/create-kalaidoscope/actions.ts";
import { CloudAuthPanel } from "@/features/onboarding/components/cloud-auth-panel";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";
import { cn } from "@/lib/css-utils";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppRouteState } from "@/routes/use-app-route-state";
import {
  CloudIdentityPanel,
  CloudSignInNotice,
} from "../components/cloud-identity-panel";
import { IconPicker } from "../components/icon-picker.tsx";
import { ProviderFields } from "../components/provider-fields";
import {
  StorageOptionCards,
  type StorageType,
} from "../components/storage-option-cards";
import { kalaidoscopeSetupTransitions } from "./KalaidoscopeSetup.transitions";

function deriveCloudId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What the user has typed and picked. Everything else on the page derives. */
interface SetupFields {
  name: string;
  icon?: string;
  /**
   * The storage card the user chose themselves, or `null` while they have not:
   * until then storage follows the route's default and the cloud session, so
   * a session that lands after first paint still flips a fresh form to Cloud —
   * and never fights a deliberate choice.
   */
  storageChoice: StorageType | null;
  llmProvider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  roleModels: Partial<Record<LlmRole, string>>;
}

const INITIAL_FIELDS: SetupFields = {
  name: "",
  storageChoice: null,
  llmProvider: "ollama",
  apiKey: "",
  defaultModel: "",
  roleModels: {},
};

export default function KalaidoscopeSetup() {
  const { goBack } = useAppNavigate();
  const routeState = useAppRouteState<"kalaidoscope-setup">();
  const { user, signedIn } = useCloudSession();

  const [fields, setFields] = useState<SetupFields>(INITIAL_FIELDS);
  const patch = (next: Partial<SetupFields>) =>
    setFields((prev) => ({ ...prev, ...next }));

  const [error, setError] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateMode, setGateMode] = useState<"signin" | "signup">("signin");
  // Creation runs as a transition: React holds `isPending` for exactly as long
  // as the async work lasts, with nothing to reset by hand on any exit path.
  const [isPending, startCreate] = useTransition();

  const nameFieldId = useId();
  const storageLabelId = useId();
  const apiKeyFieldId = useId();
  const modelFieldId = useId();
  const { highlighted: highlightedFields, trigger: triggerHighlights } =
    useRequiredHighlights({
      name: nameFieldId,
      apiKey: apiKeyFieldId,
      model: modelFieldId,
    });

  const storage: StorageType =
    fields.storageChoice ??
    routeState.defaultStorage ??
    (signedIn ? "cloud" : "local_file");
  const cloudId = deriveCloudId(fields.name);

  const byokSelected =
    storage === "local_file" && fields.llmProvider === "gemini";

  // Submitting this path opens the sign-in gate before anything is created, so
  // promising "Create Kalaidoscope" would misdescribe what the button does.
  const needsSignIn = storage === "cloud" && !signedIn;
  const submitLabel = needsSignIn ? "Sign in & create" : "Create Kalaidoscope";

  const canCreate =
    !!fields.name.trim() &&
    (storage === "local_file" || !!cloudId.trim()) &&
    (!byokSelected || (!!fields.apiKey.trim() && !!fields.defaultModel.trim()));

  /**
   * The provider config to write into the new workspace.
   *
   * Cloud workspaces get none: their AI is provided and not configurable.
   * Ollama records itself explicitly rather than being left blank — an unwritten
   * provider is indistinguishable from a workspace that predates provider
   * config, and leaves the choice as a label rather than saved state. The model
   * is not optional: the backend rejects a configured provider with no model,
   * so every role is pinned to the recommended one, which is exactly what the
   * local model set already resolves to.
   */
  function llmConfig(): WorkspaceLlmConfig | undefined {
    if (storage !== "local_file") return undefined;

    if (fields.llmProvider === "ollama") {
      return {
        provider: "ollama",
        defaultModel: RECOMMENDED_MODEL,
        roleModels: Object.fromEntries(
          LLM_ROLES.map((role) => [role, RECOMMENDED_MODEL]),
        ),
      };
    }

    return {
      provider: "gemini",
      apiKey: fields.apiKey.trim(),
      defaultModel: fields.defaultModel.trim(),
      roleModels: { ...fields.roleModels },
    };
  }

  /**
   * Validate, then create. Resolves to the message to show, or `null` — on
   * success the app stage changes and this page is unmounted underneath us.
   */
  async function runCreate(): Promise<string | null> {
    const config = llmConfig();

    if (config) {
      const validated = await validateWorkspaceLlmConfig(config);
      if (validated.isErr()) return validated.error.message;
      if (!validated.value.ok) return validationMessage(validated.value);
    }

    const result = await createKalaidoscope({
      name: fields.name,
      icon: fields.icon,
      storage,
      cloudId,
      // No location input is offered on this form: the default location.
      locationInput: "",
      llmConfig: config,
    });

    if (result.isErr()) {
      console.error("Failed to create kalaidoscope:", result.error);
      return result.error.message;
    }
    return null;
  }

  function create() {
    startCreate(async () => {
      setError(null);
      const message = await runCreate();
      startTransition(() => setError(message));
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    const missing: ("name" | "apiKey" | "model")[] = [];
    if (!fields.name.trim()) missing.push("name");
    if (byokSelected && !fields.apiKey.trim()) missing.push("apiKey");
    if (byokSelected && !fields.defaultModel.trim()) missing.push("model");

    if (missing.length > 0) {
      triggerHighlights(missing);
      return;
    }

    if (needsSignIn) {
      setGateOpen(true);
      return;
    }

    create();
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto p-8 [scrollbar-gutter:stable]">
        <PageBackButton
          onClick={() => {
            if (gateOpen) {
              setGateOpen(false);
            } else {
              goBack();
            }
          }}
        />

        {gateOpen ? (
          <div className="my-auto flex w-full max-w-lg flex-col gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sign in required
              </span>
              <h2 className="text-xl font-semibold tracking-tight">
                {gateMode === "signin"
                  ? "Create with Kalaido Cloud"
                  : "Sign up with Kalaido Cloud"}
              </h2>
              <p className="text-[15px] text-fg-3">
                Your workspace name and icon are kept.
              </p>
            </div>

            <CloudAuthPanel
              mode={gateMode}
              onModeChange={setGateMode}
              onAuthenticated={() => {
                setGateOpen(false);
                create();
              }}
            />
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="my-auto flex w-full max-w-[540px] min-h-[770px] translate-y-7 flex-col justify-start gap-6"
          >
            {routeState.firstWorkspace && (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  New workspace
                </span>
                <h1 className="text-xl font-semibold tracking-tight">
                  Welcome — create your first kalaidoscope
                </h1>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label
                htmlFor={nameFieldId}
                className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Workspace Name
              </label>
              <div className="flex items-center gap-3">
                <IconPicker
                  value={fields.icon}
                  onChange={(icon) => patch({ icon })}
                />
                <div className="relative flex flex-1 items-center">
                  <Input
                    id={nameFieldId}
                    autoFocus
                    type="text"
                    value={fields.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder="My kalaidoscope"
                    className={cn(
                      "h-12 w-full text-[20px] font-semibold tracking-wide transition-all duration-150 placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/80",
                      highlightedFields.has("name") && [
                        requiredHighlightClass,
                        "pr-24",
                      ],
                    )}
                  />
                  {highlightedFields.has("name") && (
                    <RequiredPill className="right-2" />
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <span
                id={storageLabelId}
                className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Storage
              </span>
              <StorageOptionCards
                value={storage}
                onChange={(storageChoice) => patch({ storageChoice })}
                aria-labelledby={storageLabelId}
              />

              {storage === "cloud" &&
                (signedIn && user ? (
                  <CloudIdentityPanel
                    name={user.name ?? undefined}
                    email={user.email}
                    onSignOut={() => void signOutOfCloud()}
                  />
                ) : (
                  <CloudSignInNotice onSignIn={() => setGateOpen(true)} />
                ))}
            </div>

            {storage === "local_file" && (
              <ProviderFields
                provider={fields.llmProvider}
                apiKey={fields.apiKey}
                defaultModel={fields.defaultModel}
                roleModels={fields.roleModels}
                disabled={isPending}
                highlightedFields={highlightedFields}
                apiKeyFieldId={apiKeyFieldId}
                modelFieldId={modelFieldId}
                onProviderChange={(llmProvider) => {
                  patch({ llmProvider });
                  setError(null);
                }}
                onApiKeyChange={(apiKey) => patch({ apiKey })}
                onDefaultModelChange={(defaultModel) => patch({ defaultModel })}
                onRoleModelChange={(role, model) =>
                  patch({ roleModels: { ...fields.roleModels, [role]: model } })
                }
              />
            )}

            {error && <p className="text-meta text-destructive">{error}</p>}

            <div className="flex justify-end pt-2">
              <Button
                variant="commit"
                size="default"
                type="submit"
                disabled={isPending}
                className={cn(!canCreate && "opacity-50 hover:opacity-50")}
              >
                {isPending ? "Creating…" : submitLabel}
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

export const kalaidoscopeSetupRoute = defineRoute({
  id: "kalaidoscope-setup",
  path: "/kalaidoscope/setup",
  feature: "Create Kalaidoscope",
  requiredScope: [],
  transitions: kalaidoscopeSetupTransitions,
  Component: KalaidoscopeSetup,
});
