import {
  DocBody,
  EmptyState,
  MarkdownContent,
  StatusPill,
} from "@/components/kalaido";

export interface ReflectionBodyProps {
  readOnly?: boolean;
  historical?: {
    status?: string;
  } | null;
  historicalLoading?: boolean;
  historicalContent?: string;

  status?: "loading" | "empty" | "error" | "ready";
  errorMessage?: string;
  content?: string;
}

export function ReflectionBody({
  readOnly,
  historical,
  historicalLoading,
  historicalContent,
  status,
  errorMessage,
  content,
}: ReflectionBodyProps) {
  if (readOnly) {
    return (
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-4 flex items-center gap-2.5">
          <StatusPill kind="magenta">
            past snapshot
            {historical?.status ? ` · ${historical.status}` : ""}
          </StatusPill>
          <span className="text-meta text-fg-4">
            Viewing a past reflection snapshot — read-only
          </span>
        </div>
        {historicalLoading && !historical ? (
          <div className="max-w-[500px]">
            <DocBody paragraphs={3} />
          </div>
        ) : historical ? (
          <div className="max-w-[500px] text-body leading-relaxed text-fg-1">
            {historicalContent ? (
              <MarkdownContent content={historicalContent} />
            ) : (
              "(empty snapshot)"
            )}
          </div>
        ) : (
          <EmptyState>Snapshot not found.</EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
      {status === "loading" && (
        <div className="max-w-[500px]">
          <DocBody paragraphs={3} />
        </div>
      )}

      {status === "empty" && (
        <EmptyState>
          No snapshot yet — it’ll appear here once one is generated.
        </EmptyState>
      )}

      {status === "error" && (
        <p className="text-body-sm text-destructive">
          Couldn’t load this reflection: {errorMessage}
        </p>
      )}

      {status === "ready" && (
        <div className="max-w-[500px] text-body leading-relaxed text-fg-1">
          {content ? <MarkdownContent content={content} /> : "(empty snapshot)"}
        </div>
      )}
    </div>
  );
}
