import {
  RequiredPill,
  requiredHighlightClass,
} from "@kalaido/primitives/kalaido";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Input } from "@kalaido/primitives/shadcn/input";
import type { CloudIdStatus } from "../cloud-id";

export interface CloudIdFieldProps {
  fieldId: string;
  cloudId: string;
  idTaken: boolean;
  idIsValid: boolean;
  highlighted: boolean;
  status: CloudIdStatus | null;
  suggestion: string | undefined;
  onChange: (value: string) => void;
  onAcceptSuggestion: (suggestion: string) => void;
}

export function CloudIdField({
  fieldId,
  cloudId,
  idTaken,
  idIsValid,
  highlighted,
  status,
  suggestion,
  onChange,
  onAcceptSuggestion,
}: CloudIdFieldProps) {
  const hasInvalidBorder = idTaken || (Boolean(cloudId) && !idIsValid);

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Cloud ID
      </label>
      <div className="relative flex items-center">
        <Input
          id={fieldId}
          type="text"
          value={cloudId}
          onChange={(e) =>
            onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          }
          placeholder="my-kalaidoscope"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "font-mono text-mono-sm",
            hasInvalidBorder &&
              "border-destructive focus-visible:ring-destructive",
            highlighted && [requiredHighlightClass, "pr-24"],
          )}
        />
        {highlighted && <RequiredPill className="right-2" />}
      </div>
      {status && (
        <p
          className={cn(
            "text-meta",
            status.tone === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {status.text}
          {idTaken && suggestion && (
            <>
              {" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() => onAcceptSuggestion(suggestion)}
              >
                Use {suggestion}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
