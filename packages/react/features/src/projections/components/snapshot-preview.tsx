import type { ProjectionSnapshotResponse } from "@kalaido/client/kalaidoscope/types";
import { MarkdownContent } from "@kalaido/components";
import {
  DocBody,
  EmptyState,
  Pill,
  StatusPill,
} from "@kalaido/primitives/kalaido";
import type { ProjectionSnapshotState } from "../hooks/use-projection-snapshot";
import { SnapshotEditMarkers } from "./snapshot-edit-markers";

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

function HistoricalSnapshotPreview({
  historical,
  historicalContent,
  historicalLoading,
  historicalVersion,
}: Pick<
  SnapshotPreviewProps,
  "historical" | "historicalContent" | "historicalLoading" | "historicalVersion"
>) {
  const pillLabel = `${historicalVersion ? `v${historicalVersion}` : "snapshot"}${historical?.status ? ` · ${historical.status}` : ""}`;
  return (
    <>
      <div className="mb-4 flex items-center gap-2.5">
        <StatusPill kind="magenta">{pillLabel}</StatusPill>
        <span className="text-meta text-fg-4">
          Viewing a past snapshot — read-only
        </span>
      </div>
      {historicalLoading && !historical ? (
        <div className="max-w-[640px]">
          <DocBody paragraphs={4} />
        </div>
      ) : historical ? (
        <div className="max-w-[640px] text-body leading-relaxed text-fg-1">
          {historicalContent ? (
            <MarkdownContent content={historicalContent} />
          ) : (
            "(empty snapshot)"
          )}
        </div>
      ) : (
        <EmptyState>Snapshot not found.</EmptyState>
      )}
    </>
  );
}

function LiveSnapshotPreview({
  state,
  awaitingDraftResume,
}: Pick<SnapshotPreviewProps, "state" | "awaitingDraftResume">) {
  if (state.status === "loading") {
    return (
      <div className="max-w-[640px]">
        <DocBody paragraphs={4} />
      </div>
    );
  }
  if (state.status === "empty") {
    if (awaitingDraftResume) {
      return (
        <div className="max-w-[640px]">
          <DocBody paragraphs={4} />
        </div>
      );
    }
    return (
      <EmptyState>
        No snapshot yet — it’ll appear here once one is generated.
      </EmptyState>
    );
  }
  if (state.status === "error") {
    return (
      <p className="text-body-sm text-destructive">
        Couldn’t load this projection: {state.error.message}
      </p>
    );
  }
  if (state.status !== "ready") return null;

  return (
    <>
      <div className="mb-4 flex items-center gap-2.5">
        <Pill tone="primary">plan of record</Pill>
      </div>
      <div className="flex items-start gap-8">
        <div className="max-w-[640px] flex-1 text-body leading-relaxed text-fg-1">
          {state.output.content ? (
            <MarkdownContent content={state.output.content} />
          ) : (
            "(empty snapshot)"
          )}
        </div>
        {state.current.edits && state.current.edits.length > 0 && (
          <SnapshotEditMarkers edits={state.current.edits} />
        )}
      </div>
    </>
  );
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
        <HistoricalSnapshotPreview
          historical={historical}
          historicalContent={historicalContent}
          historicalLoading={historicalLoading}
          historicalVersion={historicalVersion}
        />
      ) : (
        <LiveSnapshotPreview
          state={state}
          awaitingDraftResume={awaitingDraftResume}
        />
      )}
    </div>
  );
}
