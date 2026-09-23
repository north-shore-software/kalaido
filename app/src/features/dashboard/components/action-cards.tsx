import {
  FolderPlusIcon,
  type Icon,
  NotePencilIcon,
} from "@phosphor-icons/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";

/**
 * The two dashboard call-to-action cards. `hero` is the empty-workspace
 * treatment, `row` the compact reminder once fragments exist. One component so
 * the two cards share a single styling truth instead of a copied className.
 *
 * The Import card wears magenta rather than the dashboard's cyan — a logged
 * DESIGN.md exception, not a pattern to extend.
 */
export type ActionCardLayout = "hero" | "row";

type Tone = "section" | "commit";

const HERO_CARD_CLASS: Record<Tone, string> = {
  section: "border-cyan-edge bg-cyan-veil hover:border-cyan",
  commit: "border-magenta-edge bg-magenta-wash hover:border-magenta",
};

const HERO_MEDIA_CLASS: Record<Tone, string> = {
  section:
    "border-cyan-edge text-cyan group-hover:border-cyan group-hover:bg-cyan-wash",
  commit:
    "border-magenta-edge text-magenta group-hover:border-magenta group-hover:bg-magenta-wash",
};

interface Copy {
  title: string;
  description: string;
}

interface ActionCardProps {
  layout: ActionCardLayout;
  tone: Tone;
  icon: Icon;
  copy: Record<ActionCardLayout, Copy>;
  action: string;
  onClick: () => void;
}

function ActionCard({
  layout,
  tone,
  icon: Icon,
  copy,
  action,
  onClick,
}: ActionCardProps) {
  const { title, description } = copy[layout];

  if (layout === "row") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3.5 rounded-none border border-dashed border-line-strong px-4 py-3 text-left transition-colors hover:border-cyan-edge hover:bg-cyan-wash dark:hover:border-foreground/30 dark:hover:bg-surface-2"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-none border border-line bg-surface-1 text-fg-3 transition-colors group-hover:text-cyan dark:group-hover:text-fg-1">
          <Icon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-row font-semibold text-fg-1">{title}</span>
          <span className="truncate text-meta text-fg-3">{description}</span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-74 flex-col items-center gap-4 rounded-none border border-dashed px-5 py-10 text-center transition-colors hover:bg-surface-2",
        HERO_CARD_CLASS[tone],
      )}
    >
      <div
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-none border bg-surface-1 transition-colors",
          HERO_MEDIA_CLASS[tone],
        )}
      >
        <Icon className="size-6" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5">
        <span className="text-card-title font-bold text-fg-1">{title}</span>
        <span className="text-body-sm text-fg-3">{description}</span>
      </div>
      {/* A span, not a Button: the whole card is the click target, so a nested
          interactive element would be invalid and need a stopPropagation hack. */}
      <span className={cn(buttonVariants({ variant: tone }), "mt-auto")}>
        {action}
      </span>
    </button>
  );
}

export interface DashboardActionCardProps {
  layout: ActionCardLayout;
  onClick: () => void;
}

const CAPTURE_COPY: Record<ActionCardLayout, Copy> = {
  hero: {
    title: "Capture a new fragment",
    description:
      "Write or paste raw text, thoughts, or ideas directly into your workspace.",
  },
  row: {
    title: "Capture a new fragment",
    description: "Write or paste raw text, thoughts, or ideas directly.",
  },
};

export function CaptureFragmentCard({
  layout,
  onClick,
}: DashboardActionCardProps) {
  return (
    <ActionCard
      layout={layout}
      tone="section"
      icon={NotePencilIcon}
      copy={CAPTURE_COPY}
      action="Capture"
      onClick={onClick}
    />
  );
}

const IMPORT_COPY: Record<ActionCardLayout, Copy> = {
  hero: {
    title: "Import your notes",
    description:
      "Bring in documents, notes, or an email archive to map and organise them.",
  },
  row: {
    title: "Import more notes",
    description:
      "Add notes, papers, or archives to expand your knowledge base.",
  },
};

export function ImportNotesCard({ layout, onClick }: DashboardActionCardProps) {
  return (
    <ActionCard
      layout={layout}
      tone="commit"
      icon={FolderPlusIcon}
      copy={IMPORT_COPY}
      action="Import"
      onClick={onClick}
    />
  );
}
