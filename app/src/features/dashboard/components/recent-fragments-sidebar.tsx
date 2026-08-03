import { Fragment as F } from "react";
import { EmptyState, FragmentCard, Label, Mono } from "@/components/kalaido";
import type { RecentFragment } from "../types";

export interface RecentFragmentsSidebarProps {
  fragments: RecentFragment[];
  loading?: boolean;
}

export function RecentFragmentsSidebar({
  fragments,
  loading,
}: RecentFragmentsSidebarProps) {
  let lastDay: string | null = null;

  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line p-4 pt-5">
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
                <Mono className="mt-1 text-[10.5px] tracking-[0.08em] text-fg-4 uppercase">
                  {f.day}
                </Mono>
              )}
              <FragmentCard
                type={f.type}
                time={f.time}
                colours={f.colours}
                compact
              />
            </F>
          );
        })
      )}
    </aside>
  );
}
