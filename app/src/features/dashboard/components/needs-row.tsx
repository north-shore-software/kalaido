import { ClockIcon, FileTextIcon } from "lucide-react";
import { ListRow } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";
import type { NeedAction, NeedItem } from "../types";

export interface NeedsRowProps {
  item: NeedItem;
  onAction: (item: NeedItem) => void;
  /** This row is generating its candidate. */
  busy?: boolean;
  /** Another row is, so this one can't be started yet. */
  disabled?: boolean;
}

const actionLabel: Record<NeedAction, string> = {
  review: "Review",
  refresh: "Refresh",
  open: "Open",
};

export function NeedsRow({ item, onAction, busy, disabled }: NeedsRowProps) {
  return (
    <ListRow
      variant="card"
      leading={
        <span
          className={cn(
            "flex size-[30px] shrink-0 items-center justify-center rounded-md",
            item.kind === "reflection" ? "bg-ingest-wash" : "bg-drifting-wash",
          )}
        >
          {item.kind === "reflection" ? (
            <ClockIcon className="size-4 text-ingest-ink" />
          ) : (
            <FileTextIcon className="size-4 text-ingest-ink" />
          )}
        </span>
      }
      title={item.name}
      subtitle={item.meta}
      trailing={
        <Button
          size="sm"
          variant="outline"
          disabled={busy || disabled}
          onClick={() => onAction(item)}
        >
          {busy ? "Refreshing…" : actionLabel[item.action]}
        </Button>
      }
    />
  );
}
