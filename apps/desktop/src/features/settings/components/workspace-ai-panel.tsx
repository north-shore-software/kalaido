import {
  type LlmProvider,
  type LlmRole,
  ollamaWorkspaceLlmConfig,
  readWorkspaceLlmConfig,
  type StoredWorkspaceLlmConfig,
  type WorkspaceLlmConfig,
  writeWorkspaceLlmConfig,
} from "@kalaido/client/kalaidoscope/llm-config";
import {
  kalaidoscopeEndpointSource,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import {
  Label,
  Mono,
  StatusPill,
  useRequiredHighlights,
} from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import { useExternalWrite, useLiveRead } from "@kalaido/state/live";
import { useId, useMemo, useState } from "react";
import { ProviderFields } from "@/features/create-kalaidoscope/components/provider-fields";

const LLM_CONFIG_ENDPOINT = "llm-config";

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
  return <LocalAiPanel />;
}

function LocalAiPanel() {
  const client = useKalaidoscopeClient();
  const source = useMemo(
    () =>
      kalaidoscopeEndpointSource<StoredWorkspaceLlmConfig>({
        client,
        endpoint: LLM_CONFIG_ENDPOINT,
        watch: ["kalaidoscope_config"],
        fetch: readWorkspaceLlmConfig,
      }),
    [client],
  );
  const { data, error } = useLiveRead(source);
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
          onDone={() => setDraft(null)}
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
  const client = useKalaidoscopeClient();
  const apiKeyFieldId = useId();
  const modelFieldId = useId();
  const { highlighted, trigger } = useRequiredHighlights({
    apiKey: apiKeyFieldId,
    model: modelFieldId,
  });

  const saveWrite = useExternalWrite<WorkspaceLlmConfig, void>({
    execute: writeWorkspaceLlmConfig,
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeEndpointTag(client.baseURL, LLM_CONFIG_ENDPOINT),
    ],
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveWrite.isPending) return;

    if (draft.provider === "gemini") {
      const missing: ("apiKey" | "model")[] = [];
      if (!canKeepKey && !draft.apiKey.trim()) missing.push("apiKey");
      if (!draft.defaultModel.trim()) missing.push("model");
      if (missing.length > 0) {
        trigger(missing);
        return;
      }
    }

    const outcome = await saveWrite.run(config());
    if (outcome.status === "success") {
      onDone();
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-4"
    >
      <ProviderFields
        provider={draft.provider}
        apiKey={draft.apiKey}
        defaultModel={draft.defaultModel}
        roleModels={draft.roleModels}
        disabled={saveWrite.isPending}
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
      {saveWrite.error && (
        <span role="alert" className="text-body text-critical-ink">
          {saveWrite.error.message}
        </span>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={saveWrite.isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saveWrite.isPending}>
          {saveWrite.isPending ? <Spinner /> : "Save"}
        </Button>
      </div>
    </form>
  );
}
