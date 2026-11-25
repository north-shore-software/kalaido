import {
  type DiscoverKind,
  startDiscover,
} from "@kalaido/client/kalaidoscope/discover";
import { startMap } from "@kalaido/client/kalaidoscope/map";
import { startReconcile } from "@kalaido/client/kalaidoscope/reconcile";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useOrganizeStatus } from "@kalaido/hooks/use-organize-status";
import { useExternalWrite } from "@kalaido/state/live";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useState } from "react";
import { toast } from "sonner";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { DesktopScopeContext } from "@/state/app-state";
import { LlmQueueCard } from "../components/llm-queue-card";
import { OrganizePipelinesColumn } from "../components/organize-pipelines-column";
import { WorkspaceEventLogCard } from "../components/workspace-event-log-card";
import { useEventLog } from "../hooks/use-event-log";

export default function StatusPage() {
  const { status: organize } = useOrganizeStatus();
  const { records: queueRecords } = useLiveCollection("llm_queue_status");
  const root = useScopeContext(DesktopScopeContext);
  const rateScope = useScope({ from: root, state: ["latestInferenceRate"] });
  const { latestInferenceRate } = useScopeState(rateScope);
  const events = useEventLog();

  const [activeDiscoverKind, setActiveDiscoverKind] =
    useState<DiscoverKind | null>(null);

  const mapWrite = useExternalWrite<void, void>({
    execute: () => startMap(),
    concurrency: "ignore",
  });

  const discoverWrite = useExternalWrite<DiscoverKind, void>({
    execute: (kind) => startDiscover(kind),
    concurrency: "ignore",
  });

  const reconcileWrite = useExternalWrite<void, void>({
    execute: () => startReconcile(),
    concurrency: "ignore",
  });

  const startingMap = mapWrite.isPending;
  const startingDiscover = discoverWrite.isPending ? activeDiscoverKind : null;
  const startingReconcile = reconcileWrite.isPending;

  async function handleStartMap() {
    const outcome = await mapWrite.run();
    if (outcome.status === "error") {
      toast.error(`Map failed to start: ${outcome.error.message}`);
    }
  }

  async function handleStartDiscover(kind: DiscoverKind) {
    setActiveDiscoverKind(kind);
    const outcome = await discoverWrite.run(kind);
    if (outcome.status === "ignored") return;
    setActiveDiscoverKind(null);
    if (outcome.status === "error") {
      toast.error(`Discover failed to start: ${outcome.error.message}`);
    }
  }

  async function handleStartReconcile() {
    const outcome = await reconcileWrite.run();
    if (outcome.status === "error") {
      toast.error(`Reconcile failed to start: ${outcome.error.message}`);
    }
  }

  return (
    <PageLayout>
      <PageHeader title="Status" crumb={["Status"]} />
      <PageCard className="p-5">
        <div className="flex min-h-0 flex-1 gap-5 overflow-hidden">
          <OrganizePipelinesColumn
            organize={organize}
            startingMap={startingMap}
            startingDiscover={startingDiscover}
            startingReconcile={startingReconcile}
            onStartMap={handleStartMap}
            onStartDiscover={handleStartDiscover}
            onStartReconcile={handleStartReconcile}
          />
          <div className="flex flex-1 min-w-0 min-h-0 flex-col gap-4 overflow-hidden">
            <LlmQueueCard
              queueDoc={queueRecords[0]}
              tokensPerSecond={latestInferenceRate?.tokensPerSecond}
            />
            <WorkspaceEventLogCard events={events} />
          </div>
        </div>
      </PageCard>
    </PageLayout>
  );
}
