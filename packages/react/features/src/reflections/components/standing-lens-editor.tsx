import { Label } from "@kalaido/primitives/kalaido";
import { Textarea } from "@kalaido/primitives/shadcn/textarea";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";

export interface StandingLensEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Collapsible direct standing lens editor sitting above the Lens Chat inside
 * the `Lens` tab. Edits the staged `lensPrompt` locally without mutating the
 * live reflection until Save.
 */
export function StandingLensEditor({
  value,
  onChange,
  disabled,
}: StandingLensEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = value.trim();

  return (
    <div className="shrink-0 border-b border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <CaretDownIcon className="size-3.5 shrink-0 text-fg-3" />
          ) : (
            <CaretRightIcon className="size-3.5 shrink-0 text-fg-3" />
          )}
          <Label className="shrink-0">Standing lens</Label>
          {!expanded && (
            <span className="min-w-0 truncate text-meta text-fg-4">
              {trimmed
                ? trimmed
                : "No standing lens yet — chat below or click to write directly"}
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-mono-sm text-fg-4">
          {expanded ? "Hide" : "Edit"}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={5}
            aria-label="Standing lens prompt"
            placeholder="Describe how each time window's fragments should be summarized (structure, focus, tone, length)…"
            className="min-h-[110px] resize-y rounded-none border-line bg-surface-0 font-mono text-mono-sm text-fg-1"
          />
          <p className="text-meta text-fg-4">
            Staged locally — click Preview to test against the selected sample
            window, or Save to apply.
          </p>
        </div>
      )}
    </div>
  );
}
