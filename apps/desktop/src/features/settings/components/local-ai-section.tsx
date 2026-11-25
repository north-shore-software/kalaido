import { RECOMMENDED_MODEL } from "@kalaido/client/kalaidoscope/llm-config";
import {
  getLocalAiStatus,
  type LocalAiStatus,
  modelMatches,
  pullModel,
} from "@kalaido/client/kalaidoscope/local/models";
import { SectionHeader } from "@kalaido/primitives/layout/section";
import { Skeleton } from "@kalaido/primitives/shadcn/skeleton";
import {
  httpLiveSource,
  invalidateLiveTags,
  useLiveRead,
} from "@kalaido/state/live";
import { ok } from "neverthrow";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOllamaModel } from "@/hooks/use-ollama-model";
import { ModelDownloadCard } from "./model-download-card";
import { ModelRadioList } from "./model-radio-list";
import { OllamaStatusCard } from "./ollama-status-card";
import { QualityWarning } from "./quality-warning";

const LOCAL_AI_STATUS_TAG = "local-ai:status";

export function LocalAISection() {
  const { model, setModel } = useOllamaModel();
  const [pulling, setPulling] = useState(false);
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pullStatus, setPullStatus] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const pullAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pullAbortRef.current?.abort();
      pullAbortRef.current = null;
    };
  }, []);

  const statusSource = useMemo(
    () =>
      httpLiveSource<LocalAiStatus>({
        key: ["local-ai", "status"],
        tags: [LOCAL_AI_STATUS_TAG],
        revalidateOnFocus: true,
        fetch: async () => {
          const result = await getLocalAiStatus();
          return ok(
            result.isOk()
              ? result.value
              : {
                  reachable: false,
                  models: [],
                  error: result.error.message,
                },
          );
        },
      }),
    [],
  );

  const statusRead = useLiveRead(statusSource);
  const status = statusRead.data ?? null;
  const loading = statusRead.isLoading;

  const models = status?.models ?? [];
  const recommendedInstalled = models.some((m) =>
    modelMatches(m.name, RECOMMENDED_MODEL),
  );
  const usingRecommended = modelMatches(model, RECOMMENDED_MODEL);
  const activeName =
    models.find((m) => m.name === model)?.name ??
    models.find((m) => modelMatches(m.name, model))?.name ??
    "";

  async function handlePull() {
    setPulling(true);
    setPullError(null);
    setPullPct(null);
    setPullStatus("Starting…");
    const controller = new AbortController();
    pullAbortRef.current = controller;
    const result = await pullModel(
      RECOMMENDED_MODEL,
      (p) => {
        setPullStatus(p.status);
        setPullPct(
          p.total > 0 ? Math.round((p.completed / p.total) * 100) : null,
        );
      },
      controller.signal,
    );
    if (result.isOk()) {
      setModel(RECOMMENDED_MODEL);
      void invalidateLiveTags([LOCAL_AI_STATUS_TAG]);
    } else if (
      !(
        result.error instanceof DOMException &&
        result.error.name === "AbortError"
      )
    ) {
      setPullError(result.error.message);
    }
    setPulling(false);
    pullAbortRef.current = null;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Local AI"
        description="Kalaido generates locally with Ollama. Manage the model used for chat and projections in this kalaidoscope's backend."
      />

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <OllamaStatusCard
            reachable={!!status?.reachable}
            modelCount={models.length}
            onRefresh={() => void invalidateLiveTags([LOCAL_AI_STATUS_TAG])}
          />

          {status?.reachable && (
            <>
              {!recommendedInstalled && (
                <ModelDownloadCard
                  modelName={RECOMMENDED_MODEL}
                  pulling={pulling}
                  pullPct={pullPct}
                  pullStatus={pullStatus}
                  pullError={pullError}
                  onDownload={() => void handlePull()}
                  onCancel={() => pullAbortRef.current?.abort()}
                />
              )}

              {models.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <span className="text-label font-semibold uppercase text-fg-3">
                    Active model
                  </span>
                  <ModelRadioList
                    models={models}
                    activeName={activeName}
                    recommendedModelName={RECOMMENDED_MODEL}
                    onSelect={(v) => setModel(v)}
                  />

                  {!usingRecommended && <QualityWarning />}
                </div>
              ) : (
                !recommendedInstalled && (
                  <p className="text-body-sm text-fg-3">
                    No models installed yet. Download {RECOMMENDED_MODEL} to get
                    started.
                  </p>
                )
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
