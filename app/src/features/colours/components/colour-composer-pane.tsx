import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Chip,
  EmptyState,
  FragmentCard,
  Label,
  Mono,
} from "@/components/kalaido";
import { fragmentTypeLabel } from "@/lib/labels";
import { preview, shortTime } from "../fragments";
import { TYPE_FILTERS, type TypeFilter } from "../hooks/use-colour-preview";
import type { FragmentResponse } from "@/api/kalaidoscope/types";

/** State owned by the page via `useColourPreview`. */
export function ColourComposerPane({
  name,
  criteria,
  typeFilter,
  previewing,
  previewFragments,
  saving,
  onName,
  onCriteria,
  onTypeFilter,
  onCancel,
  onSave,
}: {
  name: string;
  criteria: string;
  typeFilter: TypeFilter;
  previewing: boolean;
  previewFragments: FragmentResponse[];
  saving: boolean;
  onName: (v: string) => void;
  onCriteria: (v: string) => void;
  onTypeFilter: (v: TypeFilter) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const canSave =
    name.trim().length > 0 && criteria.trim().length > 0 && !saving;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <div className="flex items-center justify-between">
        <span className="text-xl font-semibold">New Colour</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="commit"
            disabled={!canSave}
            onClick={onSave}
          >
            {saving ? "Creating…" : "Create colour"}
          </Button>
        </div>
      </div>

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
        <Label>Filter prompt · what should this colour match?</Label>
        <Textarea
          value={criteria}
          onChange={(e) => onCriteria(e.target.value)}
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
          <Mono className="text-[10.5px] text-fg-4">
            {previewing
              ? "matching…"
              : `${previewFragments.length} match${previewFragments.length === 1 ? "" : "es"}`}
          </Mono>
        </div>
        {criteria.trim().length === 0 ? (
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
