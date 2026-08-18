import { SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";

/**
 * The composer send button (§7): a 26px chamfered square, `line-strong`
 * outline while idle, solid section accent once armed.
 */
export function ComposerSendButton({
  onClick,
  disabled,
}: {
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "size-[26px] clip-chamfer",
        disabled
          ? "border-line-strong bg-transparent text-fg-4"
          : "border-transparent bg-section text-section-foreground hover:opacity-[0.86]",
      )}
    >
      <SendIcon />
    </Button>
  );
}
