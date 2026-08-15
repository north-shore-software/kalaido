import type { ComponentType } from "react";
import { RouteLink } from "@/routes/route-link";
import type { TransitionDef } from "@/routes/route-kit";
import { defineRoute } from "@/routes/route-kit";
import {
  ArrowRightIcon,
  DownloadIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";

import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Pill, StatusPill } from "@/components/kalaido";
import { connectionsTransitions } from "./Connections.transitions";

interface Connection {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Where the row links when available; omit for not-yet-built connections. */
  transition?: TransitionDef;
}

/**
 * The outward-facing connections for this kalaidoscope. Import ships today;
 * export and live sync are stubbed as "coming soon" so the shape of the page
 * reads correctly in the prototype.
 */
type AvailableConnection = Connection & { transition: TransitionDef };

const AVAILABLE: AvailableConnection[] = [
  {
    id: "import",
    title: "Import",
    description:
      "Bring an mbox archive, text files, or a zip of documents into this kalaidoscope.",
    icon: DownloadIcon,
    transition: connectionsTransitions.openImport,
  },
];

const COMING_SOON: Connection[] = [
  {
    id: "export",
    title: "Export",
    description:
      "Save this kalaidoscope's fragments and projections to a portable file.",
    icon: UploadIcon,
  },
  {
    id: "live-sync",
    title: "Live Sync",
    description:
      "Keep this kalaidoscope continuously in step with an outside source.",
    icon: RefreshCwIcon,
  },
];

function ConnectionRow({ c }: { c: AvailableConnection }) {
  const Icon = c.icon;
  return (
    <RouteLink
      transition={c.transition}
      className="group flex items-center gap-4 rounded-lg border border-line bg-card p-4 transition-all hover:border-line-strong"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-2">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{c.title}</h3>
          <StatusPill kind="ingest">Available</StatusPill>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
          {c.description}
        </p>
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5" />
    </RouteLink>
  );
}

function ComingSoonRow({ c }: { c: Connection }) {
  const Icon = c.icon;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-dashed border-line bg-card/40 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-4">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg-3">{c.title}</h3>
          <Pill tone="muted">Coming soon</Pill>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-4">
          {c.description}
        </p>
      </div>
    </div>
  );
}

export default function Connections() {
  return (
    <PageLayout>
      <PageHeader
        title="Connections"
        description="Move data between this kalaidoscope and the outside world."
      />
      <PageBody>
        <div className="flex max-w-2xl flex-col gap-3">
          {AVAILABLE.map((c) => (
            <ConnectionRow key={c.id} c={c} />
          ))}
          {COMING_SOON.map((c) => (
            <ComingSoonRow key={c.id} c={c} />
          ))}
        </div>
      </PageBody>
    </PageLayout>
  );
}

export const connectionsRoute = defineRoute({
  id: "connections",
  path: "/connections",
  feature: "Connections",
  requiredScope: ["kalaidoscope"],
  featureFlag: "connections",
  transitions: connectionsTransitions,
  Component: Connections,
});
