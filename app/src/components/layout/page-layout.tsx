import type { ReactNode } from "react";
import { useSnapshot } from "valtio/react";
import { NavSidebar } from "@/components/layout/nav-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { UtilityBar } from "@/components/layout/utility-bar";
import { AddFragmentModal } from "@/features/fragments";
import { appState } from "@/hooks/use-app-state.ts";
import { closeAddFragmentModal } from "@/hooks/app-state-actions.ts";

export { PageHeader, PageBody, PageCard, PaneHeader } from "./page-chrome.tsx";

export function PageLayout({ children }: { children: ReactNode }) {
  const { addFragmentModalOpen } = useSnapshot(appState);
  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      {/* Collapsed unless the user has said otherwise — the shell stays out of
          the page's way, and SidebarProvider restores their last choice. */}
      <SidebarProvider defaultOpen={false}>
        <NavSidebar />
        <SidebarInset className="min-w-0">
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <UtilityBar />
      <AddFragmentModal
        open={addFragmentModalOpen}
        onClose={() => {
          closeAddFragmentModal();
        }}
      />
    </div>
  );
}
