import { ClockIcon, FileTextIcon } from "lucide-react";
import { ListRow } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";
import type { NeedItem } from "../types";

export interface NeedsRowProps {
  item: NeedItem;
  onAction: (item: NeedItem) => void;
}

export function NeedsRow({ item, onAction }: NeedsRowProps) {
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
        <Button size="sm" variant="outline" onClick={() => onAction(item)}>
          {item.candidateId ? "Review" : "Open"}
        </Button>
      }
    />
  );
}
