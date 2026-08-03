import { Fragment as F, useMemo } from "react";
import { useParams } from "react-router-dom";
import type { FragmentTypeOptions } from "@/api/kalaidoscope/types.ts";
import { contentColour, Mono, StatusPill } from "@/components/kalaido";
import { PageHeader, PageLayout } from "@/components/layout/page-layout";
import { FragmentDrawer } from "@/features/fragments/components/fragment-drawer";
import {
  DayHeader,
  StreamCard,
  StreamEmptyState,
  StreamSkeleton,
} from "@/features/fragments/components/stream-parts";
import type { LoadedFragment } from "@/features/fragments/types";
import { useCollection } from "@/hooks/use-collection";
import { cn } from "@/lib/css-utils";
import { formatDayGroup, formatTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { streamTransitions } from "./Stream.transitions";

const formatType = (type: string) => {
  return fragmentTypeLabel(type as FragmentTypeOptions);
};

export default function Stream() {
  const { go } = useAppNavigate();
  const { id: selectedId } = useParams<{ id?: string }>();
  const { records, isLoading } = useCollection("view_stream", {
    sort: "-source_time,-created",
  });

  const filteredFragments = useMemo<LoadedFragment[]>(
    () =>
      records.map((f) => {
        const occurredStr = f.source_time || f.created;

        let parsedColours: number[] = [];
        if (typeof f.colours === "string") {
          try {
            parsedColours = JSON.parse(f.colours);
          } catch {}
        } else if (Array.isArray(f.colours)) {
          parsedColours = f.colours;
        }

        return {
          id: f.id,
          type: formatType(f.type),
          time: formatTime(occurredStr),
          day: formatDayGroup(occurredStr),
          colours: parsedColours,
          preview: f.content || "",
        };
      }),
    [records],
  );

  let lastDay: string | null = null;

  return (
    <PageLayout>
      <PageHeader title="Stream" crumb={["Kalaidoscope"]} />
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="mx-auto max-w-[720px] px-8">
          {isLoading && (
            <div className="mb-5 flex items-center gap-2.5">
              <StatusPill kind="ingest" dot>
                Loading...
              </StatusPill>
            </div>
          )}

          {isLoading ? (
            <StreamSkeleton />
          ) : filteredFragments.length === 0 ? (
            <StreamEmptyState
              onImport={() => go(streamTransitions.openImport)}
            />
          ) : (
            filteredFragments.map((f, i) => {
              const head = f.day !== lastDay;
              lastDay = f.day;
              return (
                <F key={f.id}>
                  {head && <DayHeader day={f.day} first={i === 0} />}
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-start gap-4 text-left"
                    onClick={() =>
                      go(streamTransitions.openFragment, {
                        params: { id: f.id },
                      })
                    }
                  >
                    <Mono className="w-11 shrink-0 pt-3 text-right text-[11.5px] text-fg-4">
                      {f.time}
                    </Mono>
                    <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
                      <span
                        className={cn(
                          "mt-[15px] size-[11px] shrink-0 rounded-sm ring-[3px] ring-background",
                          f.colours.length
                            ? contentColour(f.colours[0])
                            : "bg-surface-3",
                        )}
                      />
                      {i < filteredFragments.length - 1 && (
                        <div className="mt-1 min-h-6 w-0.5 flex-1 bg-line" />
                      )}
                    </div>
                    <StreamCard f={f} />
                  </button>
                </F>
              );
            })
          )}
        </div>
      </div>
      <FragmentDrawer
        id={selectedId}
        onClose={() => go(streamTransitions.closeFragment)}
      />
    </PageLayout>
  );
}

export const streamRoute = defineRoute({
  id: "stream",
  path: "/stream/:id?",
  feature: "Fragments",
  requiredScope: ["kalaidoscope"],
  transitions: streamTransitions,
  Component: Stream,
});
