import { Fragment as F } from "react";
import { EmptyState, FragmentCard, Label, Mono } from "@/components/kalaido";
import type { RecentFragment } from "../types";

export interface RecentFragmentsSidebarProps {
  fragments: RecentFragment[];
  loading?: boolean;
  onSelectFragment?: (id: string) => void;
}

export function RecentFragmentsSidebar({
  fragments,
  loading,
  onSelectFragment,
}: RecentFragmentsSidebarProps) {
  let lastDay: string | null = null;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface-1 p-4">
      <Label>Recent fragments</Label>
      {fragments.length === 0 ? (
        <EmptyState>{loading ? "Loading…" : "No fragments yet."}</EmptyState>
      ) : (
        fragments.map((f) => {
          const head = f.day !== lastDay;
          lastDay = f.day;
          return (
            <F key={f.id}>
              {head && (
                <Mono className="mt-1 text-label font-semibold text-fg-4 uppercase">
                  {f.day}
                </Mono>
              )}
              <FragmentCard
                type={f.type}
                title={f.title}
                time={f.time}
                colours={f.colours}
                compact
                onClick={
                  onSelectFragment ? () => onSelectFragment(f.id) : undefined
                }
              />
            </F>
          );
        })
      )}
    </aside>
  );
}
