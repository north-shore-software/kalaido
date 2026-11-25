import { CloudIdTakenError } from "@kalaido/client/cloud/user";
import { toError } from "@kalaido/client/lib/errors";
import { useCloudSession } from "@kalaido/hooks/use-cloud-session";
import {
  RequiredPill,
  requiredHighlightClass,
  useRequiredHighlights,
} from "@kalaido/primitives/kalaido";
import { PageBackButton } from "@kalaido/primitives/layout/page-back-button";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Input } from "@kalaido/primitives/shadcn/input";
import { useExternalWrite } from "@kalaido/state/live";
import { useId, useRef, useState } from "react";
import {
  validateWorkspaceLlmConfig,
  validationMessage,
} from "@/api/app/llm-validate.ts";
import {
  type CreateKalaidoscopeInput,
  createKalaidoscope,
} from "@/features/create-kalaidoscope/actions.ts";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppRouteState } from "@/routes/use-app-route-state";
import {
  buildSetupLlmConfig,
  deriveCloudIdState,
  findMissingSetupFields,
  INITIAL_SETUP_FIELDS,
  randomFallbackCloudId,
  type SetupFields,
} from "../cloud-id";
import { CloudIdField } from "../components/cloud-id-field";
import {
  CloudIdentityPanel,
  CloudSignInNotice,
} from "../components/cloud-identity-panel";
import { IconPicker } from "../components/icon-picker.tsx";
import { ProviderFields } from "../components/provider-fields";
import { SetupSignInGate } from "../components/setup-sign-in-gate";
import {
  StorageOptionCards,
  type StorageType,
} from "../components/storage-option-cards";
import { useCloudIdCheck } from "../hooks/use-cloud-id-check";

function WorkspaceNameField({
  fieldId,
  icon,
  initialName,
  highlighted,
  onIconChange,
  onNameChange,
}: {
  fieldId: string;
  icon?: string;
  initialName: string;
  highlighted: boolean;
  onIconChange: (icon: string) => void;
  onNameChange: (name: string) => void;
}) {
  const isComposingRef = useRef(false);

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Workspace Name
      </label>
      <div className="flex items-center gap-3">
        <IconPicker value={icon} onChange={onIconChange} />
        <div className="relative flex flex-1 items-center">
          <Input
            id={fieldId}
            autoFocus
            type="text"
            defaultValue={initialName}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              onNameChange(e.currentTarget.value);
            }}
            onChange={(e) => {
              if (!isComposingRef.current) {
                onNameChange(e.target.value);
              }
            }}
            placeholder="My kalaidoscope"
            className={cn(
              "h-12 w-full text-[20px] font-semibold tracking-wide transition-all duration-150 placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/80",
              highlighted && [requiredHighlightClass, "pr-24"],
            )}
          />
          {highlighted && <RequiredPill className="right-2" />}
        </div>
      </div>
    </div>
  );
}

function StorageAndProviderSection({
  storage,
  storageLabelId,
  signedIn,
  user,
  fields,
  derived,
  isPending,
  highlightedFields,
  cloudIdFieldId,
  apiKeyFieldId,
  modelFieldId,
  onPatch,
  onClearError,
  onRequestSignIn,
}: {
  storage: StorageType;
  storageLabelId: string;
  signedIn: boolean;
  user: { name?: string | null; email: string } | null | undefined;
  fields: SetupFields;
  derived: ReturnType<typeof deriveCloudIdState>;
  isPending: boolean;
  highlightedFields: ReadonlySet<string>;
  cloudIdFieldId: string;
  apiKeyFieldId: string;
  modelFieldId: string;
  onPatch: (next: Partial<SetupFields>) => void;
  onClearError: () => void;
  onRequestSignIn: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <span
          id={storageLabelId}
          className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Storage
        </span>
        <StorageOptionCards
          value={storage}
          onChange={(storageChoice) => onPatch({ storageChoice })}
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
            <CloudSignInNotice onSignIn={onRequestSignIn} />
          ))}
      </div>

      {storage === "cloud" && (
        <CloudIdField
          fieldId={cloudIdFieldId}
          cloudId={derived.cloudId}
          idTaken={derived.idTaken}
          idIsValid={derived.idIsValid}
          highlighted={highlightedFields.has("cloudId")}
          status={derived.status}
          suggestion={derived.checked?.suggestion}
          onChange={(cloudIdChoice) => onPatch({ cloudIdChoice })}
          onAcceptSuggestion={(cloudIdChoice) => onPatch({ cloudIdChoice })}
        />
      )}

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
            onPatch({ llmProvider });
            onClearError();
          }}
          onApiKeyChange={(apiKey) => onPatch({ apiKey })}
          onDefaultModelChange={(defaultModel) => onPatch({ defaultModel })}
          onRoleModelChange={(role, model) =>
            onPatch({ roleModels: { ...fields.roleModels, [role]: model } })
          }
        />
      )}
    </>
  );
}

export default function KalaidoscopeSetup() {
  const { goBack } = useAppNavigate();
  const routeState = useAppRouteState<"kalaidoscope-setup">();
  const { user, signedIn } = useCloudSession();

  const [fields, setFields] = useState<SetupFields>(INITIAL_SETUP_FIELDS);
  const [fallbackCloudId] = useState(randomFallbackCloudId);
  const patch = (next: Partial<SetupFields>) =>
    setFields((prev) => ({ ...prev, ...next }));

  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<"create" | "signin" | null>(null);
  const [gateMode, setGateMode] = useState<"signin" | "signup">("signin");
  const [validating, setValidating] = useState(false);

  const createWrite = useExternalWrite<
    CreateKalaidoscopeInput,
    { readonly id: string }
  >({
    execute: async (input) =>
      (await createKalaidoscope(input)).map((m) => ({ id: m.id })),
    concurrency: "ignore",
  });
  const isPending = validating || createWrite.isPending;

  const nameFieldId = useId();
  const cloudIdFieldId = useId();
  const storageLabelId = useId();
  const apiKeyFieldId = useId();
  const modelFieldId = useId();
  const { highlighted: highlightedFields, trigger: triggerHighlights } =
    useRequiredHighlights({
      name: nameFieldId,
      cloudId: cloudIdFieldId,
      apiKey: apiKeyFieldId,
      model: modelFieldId,
    });

  const storage: StorageType =
    fields.storageChoice ??
    routeState.defaultStorage ??
    (signedIn ? "cloud" : "local_file");

  const previewDerived = deriveCloudIdState({
    fields,
    fallbackCloudId,
    storage,
    signedIn,
    idCheck: null,
    idChecking: false,
  });
  const { idCheck, idChecking, recheck } = useCloudIdCheck(
    previewDerived.candidateId,
    previewDerived.cloudChecksApply,
  );
  const derived = deriveCloudIdState({
    fields,
    fallbackCloudId,
    storage,
    signedIn,
    idCheck,
    idChecking,
  });

  async function create() {
    setError(null);
    const config = buildSetupLlmConfig(storage, fields);

    if (config) {
      setValidating(true);
      let validationError: string | null = null;
      try {
        const validated = await validateWorkspaceLlmConfig(config);
        if (validated.isErr()) {
          validationError = validated.error.message;
        } else if (!validated.value.ok) {
          validationError = validationMessage(validated.value);
        }
      } catch (e) {
        validationError = toError(e).message;
      } finally {
        setValidating(false);
      }
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    const outcome = await createWrite.run({
      name: fields.name,
      icon: fields.icon,
      storage,
      cloudId: derived.cloudId,
      locationInput: "",
      llmConfig: config,
    });

    if (outcome.status === "error") {
      console.error("Failed to create kalaidoscope:", outcome.error);
      if (outcome.error instanceof CloudIdTakenError) {
        await recheck(derived.candidateId);
        setError(
          "That ID was just taken. A new one has been suggested — check it and try again.",
        );
        return;
      }
      setError(outcome.error.message);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    const missing = findMissingSetupFields({
      fields,
      storage,
      cloudId: derived.cloudId,
      byokSelected: derived.byokSelected,
    });
    if (missing.length > 0) {
      triggerHighlights(missing);
      return;
    }
    if (derived.needsSignIn) {
      setGate("create");
      return;
    }
    if (!derived.idReady) return;
    void create();
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto p-8 [scrollbar-gutter:stable]">
        <PageBackButton onClick={() => (gate ? setGate(null) : goBack())} />

        {gate ? (
          <SetupSignInGate
            mode={gateMode}
            onModeChange={setGateMode}
            onAuthenticated={() => {
              setGate(null);
              if (gate === "create") void create();
            }}
          />
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

            <WorkspaceNameField
              fieldId={nameFieldId}
              icon={fields.icon}
              initialName={fields.name}
              highlighted={highlightedFields.has("name")}
              onIconChange={(icon) => patch({ icon })}
              onNameChange={(name) => patch({ name })}
            />

            <StorageAndProviderSection
              storage={storage}
              storageLabelId={storageLabelId}
              signedIn={signedIn}
              user={user}
              fields={fields}
              derived={derived}
              isPending={isPending}
              highlightedFields={highlightedFields}
              cloudIdFieldId={cloudIdFieldId}
              apiKeyFieldId={apiKeyFieldId}
              modelFieldId={modelFieldId}
              onPatch={patch}
              onClearError={() => setError(null)}
              onRequestSignIn={() => setGate("signin")}
            />

            {error && <p className="text-meta text-destructive">{error}</p>}

            <div className="flex justify-end pt-2">
              <Button
                variant="commit"
                size="default"
                type="submit"
                disabled={isPending}
                className={cn(
                  !derived.canCreate && "opacity-50 hover:opacity-50",
                )}
              >
                {isPending ? "Creating…" : derived.submitLabel}
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
