import { useState } from "react";
import {
  validateWorkspaceLlmConfig,
  validationMessage,
} from "@/api/app/llm-validate";
import type {
  LlmProvider,
  LlmRole,
  WorkspaceLlmConfig,
} from "@/api/kalaidoscope/llm-config";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProviderFields } from "@/features/create-kalaidoscope/components/provider-fields";

interface RestoreProviderDialogProps {
  open: boolean;
  onConfirm: (config: WorkspaceLlmConfig | undefined) => void;
  onCancel: () => void;
}

export function RestoreProviderDialog({
  open,
  onConfirm,
  onCancel,
}: RestoreProviderDialogProps) {
  const [provider, setProvider] = useState<LlmProvider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [roleModels, setRoleModels] = useState<
    Partial<Record<LlmRole, string>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    provider === "ollama" || (!!apiKey.trim() && !!defaultModel.trim());

  async function handleConfirm() {
    if (provider === "ollama") {
      onConfirm(undefined);
      return;
    }

    const config: WorkspaceLlmConfig = {
      provider,
      apiKey: apiKey.trim(),
      defaultModel: defaultModel.trim(),
      roleModels,
    };

    setBusy(true);
    setError(null);

    const validated = await validateWorkspaceLlmConfig(config);
    setBusy(false);

    if (validated.isErr()) {
      setError(validated.error.message);
      return;
    }
    if (!validated.value.ok) {
      setError(validationMessage(validated.value));
      return;
    }

    onConfirm(config);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>This backup needs a model</AlertDialogTitle>
          <AlertDialogDescription>
            API keys are stripped from backups. Enter a new key for this
            workspace, or switch it to a local Ollama model.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ProviderFields
          provider={provider}
          apiKey={apiKey}
          defaultModel={defaultModel}
          roleModels={roleModels}
          disabled={busy}
          onProviderChange={(next) => {
            setProvider(next);
            setError(null);
          }}
          onApiKeyChange={setApiKey}
          onDefaultModelChange={setDefaultModel}
          onRoleModelChange={(role, model) =>
            setRoleModels((prev) => ({ ...prev, [role]: model }))
          }
        />

        {error && <p className="text-meta text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void handleConfirm()}
            disabled={!ready || busy}
          >
            {busy ? "Checking…" : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
