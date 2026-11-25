import { updateReflection } from "@kalaido/client/kalaidoscope/reflections";
import type { ReflectionResponse } from "@kalaido/client/kalaidoscope/types";
import { PageHeader } from "@kalaido/components";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { EmptyState, ListRow, PinToggle } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import { ClockIcon, PlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ReflectionSeriesPanel } from "./components/reflection-series-panel";
import { currentWindowSpec, describeWindow } from "./schedule";

export interface ReflectionsScreenProps {
  id?: string;
  windowId?: string;
  onNewReflection: () => void;
  onSelectReflection: (id: string) => void;
  onSelectWindow: (id: string, windowId: string) => void;
  onRefine: (id: string) => void;
}

export function ReflectionsScreen({
  id,
  windowId,
  onNewReflection,
  onSelectReflection,
  onSelectWindow,
  onRefine,
}: ReflectionsScreenProps) {
  const { records: reflections, isLoading } = useLiveCollection("reflection", {
    filter: 'name != "" && status = "active" && deleted_at = ""',
    sort: "-updated",
  });

  const pinWrite = useExternalWrite<ReflectionResponse, void>({
    execute: async (r) =>
      (await updateReflection(r.id, { pinned: !r.pinned })).map(
        () => undefined,
      ),
    concurrency: "allow",
  });

  async function togglePin(r: ReflectionResponse) {
    const outcome = await pinWrite.run(r);
    if (outcome.status === "error") {
      toast.error("Failed to update pin", {
        description: outcome.error.message,
      });
    }
  }

  const activeId =
    id || (reflections.length > 0 ? reflections[0].id : undefined);

  return (
    <>
      <PageHeader
        title="Reflections"
        actions={
          <Button variant="section" onClick={onNewReflection}>
            <PlusIcon />
            New Reflection
          </Button>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[280px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-line p-3">
            {reflections.length === 0 ? (
              <EmptyState className="p-3">
                {isLoading ? "Loading..." : "No reflections yet."}
              </EmptyState>
            ) : (
              reflections.map((r) => {
                const { freq, win } = describeWindow(
                  currentWindowSpec(r.window_spec_versions),
                );
                return (
                  <ListRow
                    key={r.id}
                    selected={r.id === activeId}
                    onClick={() => onSelectReflection(r.id)}
                    leading={
                      <>
                        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-none border border-line bg-card">
                          <ClockIcon className="size-3.5 text-fg-3" />
                        </span>
                        <span className="size-[11px] bg-section rounded-none shrink-0" />
                      </>
                    }
                    title={r.name || "Untitled reflection"}
                    subtitle={`${freq} · last ${win}`}
                    trailing={
                      <PinToggle
                        pinned={Boolean(r.pinned)}
                        onToggle={() => void togglePin(r)}
                      />
                    }
                  />
                );
              })
            )}
          </div>
          {activeId ? (
            <ReflectionSeriesPanel
              reflectionId={activeId}
              windowId={windowId}
              onSelectWindow={(nextWindowId) =>
                onSelectWindow(activeId, nextWindowId)
              }
              onRefine={() => onRefine(activeId)}
            />
          ) : (
            <EmptyState centered>Select a reflection</EmptyState>
          )}
        </div>
      </PageCard>
    </>
  );
}
