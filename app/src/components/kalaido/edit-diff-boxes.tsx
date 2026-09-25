import { CaretRightIcon } from "@phosphor-icons/react";
import {
  MarkdownContent,
  type MarkdownVariant,
} from "@/components/kalaido/markdown-content";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/css-utils";

export interface EditDiffBoxesProps {
  before?: string;
  after?: string;
  variant?: MarkdownVariant;
  /**
   * Tuck the replaced text behind a closed disclosure. On a proposal card the
   * reader is reading the document, and the new text is the document; what it
   * displaces is the audit trail, there to check rather than to read.
   */
  collapseBefore?: boolean;
  className?: string;
}

export function EditDiffBoxes({
  before,
  after,
  variant = "document",
  collapseBefore = false,
  className,
}: EditDiffBoxesProps) {
  if (!before && !after) return null;

  const beforeBox = before ? (
    <div
      className={cn(
        "rounded-none border border-critical/30 bg-critical-wash/20 line-through opacity-75",
        variant === "chat" ? "p-2 text-fg-2" : "p-2.5",
      )}
    >
      <MarkdownContent variant={variant} content={before} />
    </div>
  ) : null;

  return (
    <div className={cn("space-y-2", className)}>
      {beforeBox &&
        (collapseBefore ? (
          <Collapsible>
            <CollapsibleTrigger className="group flex w-fit cursor-pointer items-center gap-1 font-mono text-meta text-fg-4 hover:text-fg-2">
              <CaretRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
              <span>Replaced text</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              {beforeBox}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          beforeBox
        ))}
      {after && (
        <div
          className={cn(
            "rounded-none border border-stable/30 bg-stable-wash/20",
            variant === "chat" ? "p-2 text-fg-1" : "p-2.5",
          )}
        >
          <MarkdownContent variant={variant} content={after} />
        </div>
      )}
    </div>
  );
}
