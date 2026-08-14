import type { KeyboardEvent } from "react";
import { SendIcon } from "lucide-react";
import { PaneHeader } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/css-utils";

export interface RefineComposerProps {
  title?: string;
  helperText?: string;
  helperTextClassName?: string;
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  onSubmit?: () => void;
  preparing?: boolean;
  preparingText?: string;
}

export function RefineComposer({
  title,
  helperText,
  helperTextClassName,
  value = "",
  onChange,
  placeholder,
  disabled = false,
  busy = false,
  onSubmit,
  preparing = false,
  preparingText = "Preparing refine session…",
}: RefineComposerProps) {
  if (preparing) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-[12px] text-fg-2">{preparingText}</p>
      </div>
    );
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (onSubmit && value.trim() && !disabled && !busy) {
        onSubmit();
      }
    }
  };

  const isSubmitDisabled = !value.trim() || disabled || busy;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {title && <PaneHeader label={title} />}
      {helperText && (
        <div className="flex flex-1 items-center justify-center px-4 py-2">
          <p
            className={cn(
              "text-center text-sm text-muted-foreground",
              helperTextClassName,
            )}
          >
            {helperText}
          </p>
        </div>
      )}
      <div className="shrink-0 border-t p-4">
        <div className="flex items-end gap-2">
          <Textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled || busy}
            className="max-h-40 min-h-0 flex-1 overflow-y-auto"
          />
          <Button size="icon-sm" onClick={onSubmit} disabled={isSubmitDisabled}>
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
