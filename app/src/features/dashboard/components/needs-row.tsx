import { ClockIcon, FileTextIcon } from "lucide-react";
import { ListRow } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
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
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-none bg-surface-2">
          {item.kind === "reflection" ? (
            <ClockIcon className="size-4 text-fg-3" />
          ) : (
            <FileTextIcon className="size-4 text-fg-3" />
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
