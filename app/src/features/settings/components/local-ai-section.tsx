import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/layout/section";
import {
  getLocalAiStatus,
  type LocalAiStatus,
  modelMatches,
  pullModel,
} from "@/api/kalaidoscope/local/models";
import { RECOMMENDED_MODEL } from "@/api/kalaidoscope/llm-config";
import { useOllamaModel } from "@/hooks/use-ollama-model";

import { OllamaStatusCard } from "./ollama-status-card";
import { ModelDownloadCard } from "./model-download-card";
import { ModelRadioList } from "./model-radio-list";
import { QualityWarning } from "./quality-warning";

export function LocalAISection() {
  const { model, setModel } = useOllamaModel();
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pullStatus, setPullStatus] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const pullAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getLocalAiStatus();
      if (result.isOk()) {
        setStatus(result.value);
      } else {
        setStatus({
          reachable: false,
          models: [],
          error: result.error.message,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      void refresh();
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
    <div className="flex max-w-xl flex-col gap-6">
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
            onRefresh={() => void refresh()}
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
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                  <p className="text-sm text-muted-foreground">
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
