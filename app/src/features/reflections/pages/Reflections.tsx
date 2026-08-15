import { ClockIcon, PlusIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { defineRoute } from "@/routes/route-kit";
import { reflectionsTransitions } from "./Reflections.transitions";
import { toast } from "sonner";
import { useAppNavigate } from "@/routes/use-app-navigate";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  ColourSwatch,
  EmptyState,
  ListRow,
  PinToggle,
} from "@/components/kalaido";
import { ReflectionDetailPanel } from "../components/reflection-detail-panel";
import { swatchIndex } from "@/lib/colors";
import {
  currentWindowSpec,
  describeWindow,
} from "@/features/reflections/schedule";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { isPinned } from "@/lib/pins";
import { updateReflection } from "@/api/kalaidoscope/reflections";
import type { ReflectionResponse } from "@/api/kalaidoscope/types";

async function togglePin(r: ReflectionResponse) {
  const res = await updateReflection(r.id, { pinned: !isPinned(r.pinned_by) });
  if (res.isErr())
    toast.error("Failed to update pin", { description: res.error.message });
}

export default function Reflections() {
  const { go } = useAppNavigate();
  const { id, snapshotId } = useParams<{ id?: string; snapshotId?: string }>();

  const { records: reflections, isLoading } = useLiveCollection("reflection", {
    filter: 'name != ""',
    sort: "-updated",
  });

  const activeId =
    id || (reflections.length > 0 ? reflections[0].id : undefined);

  return (
    <PageLayout>
      <PageHeader
        title="Reflections"
        actions={
          <Button
            size="sm"
            onClick={() => go(reflectionsTransitions.newReflection)}
          >
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
                    onClick={() =>
                      go(reflectionsTransitions.selectReflection, {
                        params: { id: r.id },
                      })
                    }
                    leading={
                      <>
                        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md border border-line bg-card">
                          <ClockIcon className="size-3.5 text-fg-3" />
                        </span>
                        <ColourSwatch c={swatchIndex(r.id)} size={11} />
                      </>
                    }
                    title={r.name || "Untitled reflection"}
                    subtitle={`${freq} · last ${win}`}
                    trailing={
                      <PinToggle
                        pinned={isPinned(r.pinned_by)}
                        onToggle={() => void togglePin(r)}
                      />
                    }
                  />
                );
              })
            )}
          </div>
          {activeId ? (
            <ReflectionDetailPanel
              reflectionId={activeId}
              snapshotId={snapshotId}
            />
          ) : (
            <EmptyState centered>Select a reflection</EmptyState>
          )}
        </div>
      </PageCard>
    </PageLayout>
  );
}

export const reflectionsRoute = defineRoute({
  id: "reflections",
  path: "/reflections/:id?",
  aliases: ["/reflections/:id/snapshot/:snapshotId"],
  feature: "Reflections",
  requiredScope: ["kalaidoscope"],
  transitions: reflectionsTransitions,
  Component: Reflections,
});
