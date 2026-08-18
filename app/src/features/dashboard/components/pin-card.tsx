import { ClockIcon, FileTextIcon, PinOffIcon } from "lucide-react";
import { DocumentCard, StatusPill } from "@/components/kalaido";
import type { EntityKind, PinItem } from "../types";

export interface PinCardProps {
  item: PinItem;
  onOpen: (item: PinItem) => void;
  onUnpin: (item: PinItem) => void;
}

function PinIcon({ kind }: { kind: EntityKind }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-none bg-surface-2">
      {kind === "projection" ? (
        <FileTextIcon className="size-3.5 text-[#4ade80]" />
      ) : (
        <ClockIcon className="size-3.5 text-[#c084fc]" />
      )}
    </span>
  );
}

export function PinCard({ item, onOpen, onUnpin }: PinCardProps) {
  const isProj = item.kind === "projection";
  return (
    <DocumentCard
      className="w-[calc(50%-7px)]"
      onClick={() => onOpen(item)}
      leading={
        <>
          <PinIcon kind={item.kind} />
          <span
            className={
              isProj
                ? "size-[11px] bg-[#4ade80] rounded-none shrink-0"
                : "size-[11px] bg-[#c084fc] rounded-none shrink-0"
            }
          />
        </>
      }
      title={item.name}
      trailing={
        <>
          <StatusPill
            className={
              isProj
                ? "border-[#4ade80]/45 bg-[#4ade80]/10 text-[#4ade80]"
                : "border-[#c084fc]/45 bg-[#c084fc]/10 text-[#c084fc]"
            }
          >
            {isProj ? "PROJ" : "REFL"}
          </StatusPill>
          <button
            type="button"
            aria-label="Unpin"
            className="flex size-6 items-center justify-center rounded-none text-fg-4 transition-colors hover:bg-surface-2 hover:text-fg-2"
            onClick={(e) => {
              e.stopPropagation();
              onUnpin(item);
            }}
          >
            <PinOffIcon className="size-3.5" />
          </button>
        </>
      }
      lines={["100%", "92%", "60%"]}
      contentClassName="h-[74px]"
    />
  );
}
