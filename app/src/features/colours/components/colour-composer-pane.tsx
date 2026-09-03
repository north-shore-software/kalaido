import type { FragmentResponse } from "@/api/kalaidoscope/types";
import {
  Chip,
  EmptyState,
  FragmentCard,
  Label,
  Mono,
} from "@/components/kalaido";
import { Textarea } from "@/components/ui/textarea";
import { fragmentTypeLabel } from "@/lib/labels";
import { preview, shortTime } from "../fragments";
import { TYPE_FILTERS, type TypeFilter } from "../hooks/use-colour-preview";

/** State owned by the page via `useColourPreview`. */
export function ColourComposerPane({
  name,
  prompt,
  typeFilter,
  previewing,
  previewFragments,
  onName,
  onPrompt,
  onTypeFilter,
}: {
  name: string;
  prompt: string;
  typeFilter: TypeFilter;
  previewing: boolean;
  previewFragments: FragmentResponse[];
  onName: (v: string) => void;
  onPrompt: (v: string) => void;
  onTypeFilter: (v: TypeFilter) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <div className="flex flex-col gap-2">
        <Label>Name</Label>
        <Textarea
          value={name}
          onChange={(e) => onName(e.target.value)}
          rows={1}
          placeholder="e.g. Customer feedback"
          className="max-h-20 min-h-0"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Prompt · what should this colour match?</Label>
        <Textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={3}
          placeholder="Incoming messages & emails about product pain points…"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Preview type · filter the live match preview</Label>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((t) => (
            <Chip
              key={t}
              active={t === typeFilter}
              onClick={() => onTypeFilter(t)}
            >
              {t === "all" ? "All" : fragmentTypeLabel(t)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Live preview</Label>
          <Mono className="text-meta text-fg-4">
            {previewing
              ? "matching…"
              : `${previewFragments.length} match${previewFragments.length === 1 ? "" : "es"}`}
          </Mono>
        </div>
        {prompt.trim().length === 0 ? (
          <EmptyState>Describe what to match to see a live preview.</EmptyState>
        ) : previewFragments.length === 0 && !previewing ? (
          <EmptyState>No matches yet — try broadening the prompt.</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-3">
            {previewFragments.map((f) => (
              <div key={f.id} className="w-[calc(50%-6px)]">
                <FragmentCard
                  type={fragmentTypeLabel(f.type)}
                  time={shortTime(f.source_time ?? f.created)}
                  preview={preview(f.content)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
