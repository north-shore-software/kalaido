import { useId, useState, useTransition } from "react";
import useSWR from "swr";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import {
  type LlmProvider,
  type LlmRole,
  ollamaWorkspaceLlmConfig,
  readWorkspaceLlmConfig,
  type StoredWorkspaceLlmConfig,
  type WorkspaceLlmConfig,
  writeWorkspaceLlmConfig,
} from "@/api/kalaidoscope/llm-config.ts";
import {
  Label,
  Mono,
  StatusPill,
  useRequiredHighlights,
} from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ProviderFields } from "@/features/create-kalaidoscope/components/provider-fields";

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  ollama: "Local Ollama",
  gemini: "Google Gemini",
};

interface Draft {
  provider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  roleModels: Partial<Record<LlmRole, string>>;
}

/**
 * The open kalaidoscope's model provider, shown inside its settings row. Only
 * the open one can be edited: the config lives in the workspace's own backend,
 * and the others aren't running.
 */
export function WorkspaceAiPanel({
  kalaidoscope,
}: {
  kalaidoscope: KalaidoscopeMeta;
}) {
  if (kalaidoscope.type === "cloud") {
    return (
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <Label>AI provider</Label>
        <span className="text-body text-muted-foreground">
          AI is provided by Kalaido Cloud.
        </span>
      </div>
    );
  }
  return <LocalAiPanel kalaidoscopeId={kalaidoscope.id} />;
}

function LocalAiPanel({ kalaidoscopeId }: { kalaidoscopeId: string }) {
  const { data, error, mutate } = useSWR(
    ["workspace-llm-config", kalaidoscopeId],
    async () => {
      const result = await readWorkspaceLlmConfig();
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-2.5">
      <div className="flex items-center gap-2.5">
        <Label>AI provider</Label>
        <div className="flex-1" />
        {data && !draft && (
          <Button variant="outline" onClick={() => setDraft(draftFrom(data))}>
            Change
          </Button>
        )}
      </div>
      {error ? (
        <span className="text-body text-critical-ink">
          Couldn't load this kalaidoscope's AI settings: {error.message}
        </span>
      ) : !data ? (
        <Spinner />
      ) : draft ? (
        <ProviderEditor
          stored={data}
          draft={draft}
          onDraftChange={setDraft}
          onDone={() => {
            setDraft(null);
            void mutate();
          }}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <ProviderSummary stored={data} />
      )}
    </div>
  );
}

function ProviderSummary({ stored }: { stored: StoredWorkspaceLlmConfig }) {
  if (!stored.provider) {
    return (
      <span className="text-body text-muted-foreground">
        No provider configured.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-body">
      <span>{PROVIDER_LABELS[stored.provider]}</span>
      {stored.provider === "gemini" && (
        <>
          {stored.defaultModel && <Mono>{stored.defaultModel}</Mono>}
          {stored.hasApiKey ? (
            <StatusPill kind="stable">key set</StatusPill>
          ) : (
            <StatusPill kind="critical">no key</StatusPill>
          )}
        </>
      )}
    </div>
  );
}

function draftFrom(stored: StoredWorkspaceLlmConfig): Draft {
  const provider = stored.provider ?? "ollama";
  return {
    provider,
    apiKey: "",
    // An Ollama workspace pins its models to the recommended one; carrying that
    // over would prefill the Gemini fields with a model Gemini doesn't have.
    defaultModel: provider === "gemini" ? stored.defaultModel : "",
    roleModels: provider === "gemini" ? { ...stored.roleModels } : {},
  };
}

function ProviderEditor({
  stored,
  draft,
  onDraftChange,
  onDone,
  onCancel,
}: {
  stored: StoredWorkspaceLlmConfig;
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();
  const apiKeyFieldId = useId();
  const modelFieldId = useId();
  const { highlighted, trigger } = useRequiredHighlights({
    apiKey: apiKeyFieldId,
    model: modelFieldId,
  });

  // The stored key can only be kept while staying on Gemini: it can't be read
  // back, and Ollama clears it.
  const canKeepKey = stored.provider === "gemini" && stored.hasApiKey;
  const patch = (next: Partial<Draft>) => onDraftChange({ ...draft, ...next });

  function config(): WorkspaceLlmConfig {
    if (draft.provider === "ollama") return ollamaWorkspaceLlmConfig();
    const apiKey = draft.apiKey.trim();
    return {
      provider: "gemini",
      apiKey: apiKey || undefined,
      defaultModel: draft.defaultModel.trim(),
      roleModels: { ...draft.roleModels },
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    if (draft.provider === "gemini") {
      const missing: ("apiKey" | "model")[] = [];
      if (!canKeepKey && !draft.apiKey.trim()) missing.push("apiKey");
      if (!draft.defaultModel.trim()) missing.push("model");
      if (missing.length > 0) {
        trigger(missing);
        return;
      }
    }

    startSave(async () => {
      setSaveError(null);
      const result = await writeWorkspaceLlmConfig(config());
      if (result.isErr()) {
        setSaveError(result.error.message);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <ProviderFields
        provider={draft.provider}
        apiKey={draft.apiKey}
        defaultModel={draft.defaultModel}
        roleModels={draft.roleModels}
        disabled={isPending}
        highlightedFields={highlighted}
        apiKeyFieldId={apiKeyFieldId}
        modelFieldId={modelFieldId}
        apiKeyPlaceholder={
          canKeepKey ? "Leave blank to keep the current key" : undefined
        }
        onProviderChange={(provider) => patch({ provider })}
        onApiKeyChange={(apiKey) => patch({ apiKey })}
        onDefaultModelChange={(defaultModel) => patch({ defaultModel })}
        onRoleModelChange={(role, model) =>
          patch({ roleModels: { ...draft.roleModels, [role]: model } })
        }
      />
      {saveError && (
        <span role="alert" className="text-body text-critical-ink">
          {saveError}
        </span>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? <Spinner /> : "Save"}
        </Button>
      </div>
    </form>
  );
}
