import { PageHeader } from "@kalaido/components";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import { Label, Pill } from "@kalaido/primitives/kalaido";
import { PageBody } from "@kalaido/primitives/layout/page-primitives";
import { cn } from "@kalaido/primitives/lib/css-utils";
import {
  ArrowRightIcon,
  CloudIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  GithubLogoIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import {
  GoogleDriveLogo,
  SlackLogo,
  WhatsappLogo,
} from "./components/brand-logos";

interface Connection {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Action identifier when available; omit for not-yet-built connections. */
  action?: "import";
  /** Needs a publicly reachable kalaidoscope; still shown on local ones. */
  cloudOnly?: boolean;
}

/**
 * The outward-facing connections for this kalaidoscope, split by direction:
 * sources bring material in, sinks take it out. Import ships today; the rest
 * are stubbed as "coming soon" so the shape of the page reads correctly.
 */
const SOURCES: Connection[] = [
  {
    id: "import",
    title: "Import",
    description:
      "Bring an mbox archive, text files, or a zip of documents into this kalaidoscope.",
    icon: DownloadSimpleIcon,
    action: "import",
  },
  {
    id: "email",
    title: "Email",
    description: "Forward mail to this kalaidoscope's own address.",
    icon: EnvelopeSimpleIcon,
    cloudOnly: true,
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    description: "Add Kalaido to a group and its messages flow in.",
    icon: WhatsappLogo,
    cloudOnly: true,
  },
  {
    id: "github",
    title: "GitHub",
    description: "Follow a repository's commits and pull requests.",
    icon: GithubLogoIcon,
    cloudOnly: true,
  },
  {
    id: "slack",
    title: "Slack",
    description: "Follow the channels you choose as they're written.",
    icon: SlackLogo,
    cloudOnly: true,
  },
];

const SINKS: Connection[] = [
  {
    id: "export",
    title: "Export",
    description:
      "Save this kalaidoscope's fragments and projections to a portable file.",
    icon: UploadSimpleIcon,
  },
  {
    id: "email-digest",
    title: "Email",
    description: "Send projections and reflections to your inbox.",
    icon: EnvelopeSimpleIcon,
    cloudOnly: true,
  },
  {
    id: "slack-post",
    title: "Slack",
    description: "Post projections and reflections to a channel.",
    icon: SlackLogo,
    cloudOnly: true,
  },
  {
    id: "google-drive",
    title: "Google Drive",
    description: "Keep projections as documents in a Drive folder.",
    icon: GoogleDriveLogo,
  },
];

const CARD_CLASS =
  "flex aspect-square w-52 flex-col gap-3 rounded-none p-4 text-left";

function ConnectionCard({
  c,
  isCloud,
  onOpenImport,
}: {
  c: Connection;
  isCloud: boolean;
  onOpenImport?: () => void;
}) {
  const Icon = c.icon;
  const onActivate = c.action === "import" ? onOpenImport : undefined;
  const available = onActivate !== undefined;
  const content = (
    <>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-none bg-surface-2",
          available ? "text-fg-2" : "text-fg-4",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <h3
          className={cn(
            "text-row font-semibold",
            available ? "text-fg-1" : "text-fg-3",
          )}
        >
          {c.title}
        </h3>
        <p
          className={cn(
            "text-body-sm leading-relaxed",
            available ? "text-fg-3" : "text-fg-4",
          )}
        >
          {c.description}
        </p>
      </div>
      <div className="flex items-center justify-between">
        {available ? (
          <>
            <Pill tone="primary">Available</Pill>
            <ArrowRightIcon className="size-4 text-fg-4 transition-colors group-hover:text-fg-2" />
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="muted">Coming soon</Pill>
            {c.cloudOnly && !isCloud && (
              <Pill tone="muted">
                <CloudIcon />
                Cloud only
              </Pill>
            )}
          </div>
        )}
      </div>
    </>
  );

  if (onActivate) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className={cn(
          CARD_CLASS,
          "group cursor-pointer border border-line bg-card transition-colors hover:border-line-strong hover:bg-surface-2/50",
        )}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className={cn(CARD_CLASS, "border border-dashed border-line bg-card/40")}
    >
      {content}
    </div>
  );
}

function ConnectionGroup({
  title,
  description,
  connections,
  isCloud,
  onOpenImport,
}: {
  title: string;
  description: string;
  connections: Connection[];
  isCloud: boolean;
  onOpenImport?: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <Label>{title}</Label>
        <span className="text-body-sm text-fg-4">{description}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {connections.map((c) => (
          <ConnectionCard
            key={c.id}
            c={c}
            isCloud={isCloud}
            onOpenImport={onOpenImport}
          />
        ))}
      </div>
    </section>
  );
}

export interface ConnectionsScreenProps {
  onOpenImport?: () => void;
}

export function ConnectionsScreen({ onOpenImport }: ConnectionsScreenProps) {
  const isCloud = useActiveKalaidoscope()?.type === "cloud";
  return (
    <>
      <PageHeader
        title="Connections"
        description="Move data between this kalaidoscope and the outside world."
      />
      <PageBody>
        <div className="flex flex-col gap-8">
          <ConnectionGroup
            title="Sources"
            description="Where material comes in from."
            connections={SOURCES}
            isCloud={isCloud}
            onOpenImport={onOpenImport}
          />
          <ConnectionGroup
            title="Sinks"
            description="Where material goes out to."
            connections={SINKS}
            isCloud={isCloud}
            onOpenImport={onOpenImport}
          />
        </div>
      </PageBody>
    </>
  );
}
