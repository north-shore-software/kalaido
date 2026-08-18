import { TriangleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { FileEntry } from "@/api/app/ingest-file";

export interface ImportPreviewProps {
  entries: FileEntry[];
  scanning: boolean;
}

// Cap the rendered rows so a huge archive can't flood the DOM.
const MAX_ROWS = 200;

/** Filename to show: the in-archive entry path, or an on-disk file's basename. */
function entryName(path: string): string {
  const bang = path.lastIndexOf("!");
  if (bang >= 0) return path.slice(bang + 1);
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Read-only preview of what `classify_path` found inside the picked file — a
 * "here's what the backend will do" view. The whole file is still uploaded as
 * is; unsupported (binary) entries are flagged because the backend skips them.
 */
export function ImportPreview({ entries, scanning }: ImportPreviewProps) {
  if (scanning) {
    return (
      <p className="flex items-center gap-2 text-body-sm text-fg-3">
        <Spinner className="size-4" />
        Scanning contents…
      </p>
    );
  }
  if (entries.length === 0) return null;

  const unsupported = entries.filter((e) => e.kind === "other").length;
  const importable = entries.length - unsupported;
  const shown = entries.slice(0, MAX_ROWS);
  const overflow = entries.length - shown.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-body-sm">
        <span className="text-fg-4">Contents</span>
        <span className="tabular-nums font-mono text-mono-sm text-fg-4">
          {importable} importable
          {unsupported > 0 ? ` · ${unsupported} unsupported` : ""}
        </span>
      </div>
      <ul className="max-h-56 divide-y divide-line overflow-auto rounded-none border border-line bg-surface-1">
        {shown
          .map((e, i) => ({ e, key: `${i}-${e.path}` }))
          .map(({ e, key }) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 px-3 py-1.5"
            >
              <span
                className="truncate font-mono text-mono-sm text-fg-1"
                title={e.path}
              >
                {entryName(e.path)}
              </span>
              {e.kind === "other" ? (
                <span className="flex shrink-0 items-center gap-1 text-meta text-destructive">
                  <TriangleAlert className="size-3.5" />
                  Unsupported
                </span>
              ) : (
                <span className="shrink-0 text-meta text-fg-4">
                  {e.kind === "docx" ? "Word" : "Text"}
                </span>
              )}
            </li>
          ))}
      </ul>
      {overflow > 0 && (
        <p className="text-meta text-fg-4">+{overflow} more…</p>
      )}
      {unsupported > 0 && (
        <p className="text-meta text-fg-4">
          Unsupported files are skipped by the import.
        </p>
      )}
    </div>
  );
}
