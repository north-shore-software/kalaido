import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import { proxy, useSnapshot } from "valtio";
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
import {
  createKalaidoscope,
  parseLocation,
} from "@/features/create-kalaidoscope/actions.ts";
import { CloudAuthPanel } from "@/features/onboarding/components/cloud-auth-panel";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";
import { cn } from "@/lib/css-utils";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
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
import type { KalaidoscopeSetupState } from "../types";
import { kalaidoscopeSetupTransitions } from "./KalaidoscopeSetup.transitions";

function deriveCloudId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function KalaidoscopeSetup() {
  const { goBack } = useAppNavigate();
  const routeState = (useLocation().state ?? {}) as KalaidoscopeSetupState;
  const { user, signedIn } = useCloudSession();

  const [state] = useState(() =>
    proxy({
      name: "",
      icon: undefined as string | undefined,
      storage: (routeState.defaultStorage ??
        (signedIn ? "cloud" : "local_file")) as StorageType,
      /** Once the user picks a card themselves, a late session must not move it. */
      storageTouched: routeState.defaultStorage !== undefined,
      locationInput: "",
      cloudId: "",
      cloudIdEdited: false,
      error: null as string | null,
      isPending: false,
      gateOpen: false,
      llmProvider: "ollama" as LlmProvider,
      apiKey: "",
      defaultModel: "",
      roleModels: {} as Partial<Record<LlmRole, string>>,
    }),
  );

  const snap = useSnapshot(state);

  const nameFieldId = useId();
  const storageLabelId = useId();
  const apiKeyFieldId = useId();
  const modelFieldId = useId();
  const [gateMode, setGateMode] = useState<"signin" | "signup">("signin");
  const { highlighted: highlightedFields, trigger: triggerHighlights } =
    useRequiredHighlights({
      name: nameFieldId,
      apiKey: apiKeyFieldId,
      model: modelFieldId,
    });

  // `useCloudSession` resolves asynchronously, and the proxy above is built
  // once, so a session that lands after first paint would otherwise leave a
  // signed-in user looking at "Local". Only applies while the storage cards are
  // still untouched — never fights a deliberate choice.
  useEffect(() => {
    if (signedIn && !state.storageTouched) state.storage = "cloud";
  }, [signedIn, state]);

  function handleStorageChange(value: StorageType) {
    state.storage = value;
    state.storageTouched = true;
  }

  function handleNameChange(value: string) {
    state.name = value;
    if (!state.cloudIdEdited) {
      state.cloudId = deriveCloudId(value);
    }
  }

  const parsedLocation = parseLocation(snap.locationInput);
  const locationIsInvalid = parsedLocation.kind === "invalid";

  const byokSelected =
    snap.storage === "local_file" && snap.llmProvider === "gemini";

  // Submitting this path opens the sign-in gate before anything is created, so
  // promising "Create Kalaidoscope" would misdescribe what the button does.
  const needsSignIn = snap.storage === "cloud" && !signedIn;
  const forImport = routeState.intent === "import";
  const submitLabel = needsSignIn
    ? "Sign in & create"
    : forImport
      ? "Create & import"
      : "Create Kalaidoscope";

  const canCreate =
    !!snap.name.trim() &&
    !locationIsInvalid &&
    (snap.storage === "local_file" || !!snap.cloudId.trim()) &&
    (!byokSelected || (!!snap.apiKey.trim() && !!snap.defaultModel.trim()));

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
    if (state.storage !== "local_file") return undefined;

    if (state.llmProvider === "ollama") {
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
      apiKey: state.apiKey.trim(),
      defaultModel: state.defaultModel.trim(),
      roleModels: { ...state.roleModels },
    };
  }

  async function runCreate() {
    state.isPending = true;
    state.error = null;

    const config = llmConfig();

    if (config) {
      const validated = await validateWorkspaceLlmConfig(config);
      if (validated.isErr()) {
        state.error = validated.error.message;
        state.isPending = false;
        return;
      }
      if (!validated.value.ok) {
        state.error = validationMessage(validated.value);
        state.isPending = false;
        return;
      }
    }

    const result = await createKalaidoscope({
      name: state.name,
      icon: state.icon,
      storage: state.storage,
      cloudId: state.cloudId,
      locationInput: state.locationInput,
      llmConfig: config,
      entry: forImport ? "onboarding-import" : undefined,
    });

    if (result.isErr()) {
      console.error("Failed to create kalaidoscope:", result.error);
      state.error = result.error.message;
      state.isPending = false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.isPending) return;

    const missing: ("name" | "apiKey" | "model")[] = [];
    if (!state.name.trim()) missing.push("name");
    if (byokSelected && !state.apiKey.trim()) missing.push("apiKey");
    if (byokSelected && !state.defaultModel.trim()) missing.push("model");

    if (missing.length > 0) {
      triggerHighlights(missing);
      return;
    }

    if (locationIsInvalid) {
      return;
    }

    if (needsSignIn) {
      state.gateOpen = true;
      return;
    }

    await runCreate();
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto p-8 [scrollbar-gutter:stable]">
        <PageBackButton
          onClick={() => {
            if (snap.gateOpen) {
              state.gateOpen = false;
            } else {
              goBack();
            }
          }}
        />

        {snap.gateOpen ? (
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
                state.gateOpen = false;
                void runCreate();
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
                  value={snap.icon}
                  onChange={(icon) => (state.icon = icon)}
                />
                <div className="relative flex flex-1 items-center">
                  <Input
                    id={nameFieldId}
                    autoFocus
                    type="text"
                    value={snap.name}
                    onChange={(e) => handleNameChange(e.target.value)}
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
                value={snap.storage}
                onChange={handleStorageChange}
                aria-labelledby={storageLabelId}
              />

              {snap.storage === "cloud" &&
                (signedIn && user ? (
                  <CloudIdentityPanel
                    name={user.name ?? undefined}
                    email={user.email}
                    onSignOut={() => void signOutOfCloud()}
                  />
                ) : (
                  <CloudSignInNotice onSignIn={() => (state.gateOpen = true)} />
                ))}
            </div>

            {snap.storage === "local_file" && (
              <ProviderFields
                provider={snap.llmProvider}
                apiKey={snap.apiKey}
                defaultModel={snap.defaultModel}
                roleModels={snap.roleModels}
                disabled={snap.isPending}
                highlightedFields={highlightedFields}
                apiKeyFieldId={apiKeyFieldId}
                modelFieldId={modelFieldId}
                onProviderChange={(provider) => {
                  state.llmProvider = provider;
                  state.error = null;
                }}
                onApiKeyChange={(apiKey) => (state.apiKey = apiKey)}
                onDefaultModelChange={(model) => (state.defaultModel = model)}
                onRoleModelChange={(role, model) => {
                  state.roleModels[role] = model;
                }}
              />
            )}

            {snap.error && (
              <p className="text-meta text-destructive">{snap.error}</p>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="commit"
                size="default"
                type="submit"
                disabled={snap.isPending}
                className={cn(!canCreate && "opacity-50 hover:opacity-50")}
              >
                {snap.isPending ? "Creating…" : submitLabel}
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
