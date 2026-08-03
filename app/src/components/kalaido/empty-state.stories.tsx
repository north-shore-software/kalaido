import type { Story } from "@ladle/react";
import { EmptyState } from "./empty-state.tsx";

export default { title: "Kalaido / EmptyState" };

export const DefaultInline: Story = () => (
  <div className="p-4 max-w-sm">
    <EmptyState>No items recorded in this stream yet.</EmptyState>
  </div>
);

export const InlineWithAction: Story = () => (
  <div className="p-4 max-w-sm">
    <EmptyState
      action={
        <button
          type="button"
          className="px-3 py-1 bg-surface-2 hover:bg-surface-3 text-xs font-semibold rounded-md border"
        >
          Ingest Sample
        </button>
      }
    >
      No database snapshot detected.
    </EmptyState>
  </div>
);

export const CenteredFallback: Story = () => (
  <div className="h-[200px] border border-dashed rounded-lg bg-card p-4">
    <EmptyState
      centered
      action={
        <button
          type="button"
          className="px-3 py-1.5 bg-foreground text-background text-xs font-semibold rounded-md"
        >
          Create New Document
        </button>
      }
    >
      Select a document from the left sidebar to view its details or start a
      fresh revision.
    </EmptyState>
  </div>
);
