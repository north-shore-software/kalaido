import { DocBody, EmptyState, Pill, StatusPill } from "@/components/kalaido";
import type { ProjectionSnapshotState } from "@/hooks/use-projection-snapshot";
import type { ProjectionSnapshotResponse } from "@/api/kalaidoscope/types";

export interface SnapshotPreviewProps {
  state: ProjectionSnapshotState;
  /** An uncommitted draft exists and is about to be resumed — show a skeleton
   *  instead of the empty state while it loads. */
  awaitingDraftResume: boolean;
  readOnly: boolean;
  historical: ProjectionSnapshotResponse | undefined;
  historicalContent: string | undefined;
  historicalLoading: boolean;
  historicalVersion: number | undefined;
}

export function SnapshotPreview({
  state,
  awaitingDraftResume,
  readOnly,
  historical,
  historicalContent,
  historicalLoading,
  historicalVersion,
}: SnapshotPreviewProps) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
      {readOnly ? (
        <>
          <div className="mb-4 flex items-center gap-2.5">
            <StatusPill kind="magenta">
              {historicalVersion ? `v${historicalVersion}` : "snapshot"}
              {historical?.status ? ` · ${historical.status}` : ""}
            </StatusPill>
            <span className="text-[11.5px] text-fg-4">
              Viewing a past snapshot — read-only
            </span>
          </div>
          {historicalLoading && !historical ? (
            <div className="max-w-[640px]">
              <DocBody paragraphs={4} />
            </div>
          ) : historical ? (
            <div className="max-w-[640px] whitespace-pre-wrap text-[13px] leading-relaxed">
              {historicalContent || "(empty snapshot)"}
            </div>
          ) : (
            <EmptyState>Snapshot not found.</EmptyState>
          )}
        </>
      ) : (
        <>
          {state.status === "loading" && (
            <div className="max-w-[640px]">
              <DocBody paragraphs={4} />
            </div>
          )}

          {state.status === "empty" &&
            (awaitingDraftResume ? (
              <div className="max-w-[640px]">
                <DocBody paragraphs={4} />
              </div>
            ) : (
              <EmptyState>
                No snapshot yet — it’ll appear here once one is generated.
              </EmptyState>
            ))}

          {state.status === "error" && (
            <p className="text-[13px] text-destructive">
              Couldn’t load this projection: {state.error.message}
            </p>
          )}

          {state.status === "ready" && (
            <>
              <div className="mb-4 flex items-center gap-2.5">
                <Pill tone="primary">plan of record</Pill>
              </div>
              <div className="max-w-[640px] whitespace-pre-wrap text-[13px] leading-relaxed">
                {state.output.content || "(empty snapshot)"}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
