import type { ReactNode } from "react";
import { useSnapshot } from "valtio/react";
import { PanelErrorBoundary } from "@/components/kalaido/panel-error-boundary";
import { NavSidebar } from "@/components/layout/nav-sidebar";
import { UtilityBar } from "@/components/layout/utility-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AddFragmentModal } from "@/features/fragments";
import { closeAddFragmentModal } from "@/hooks/app-state-actions.ts";
import { appState } from "@/hooks/use-app-state.ts";

export { PageBody, PageCard, PageHeader, PaneHeader } from "./page-chrome.tsx";

export function PageLayout({ children }: { children: ReactNode }) {
  const { addFragmentModalOpen } = useSnapshot(appState);
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      {/* Collapsed unless the user has said otherwise — the shell stays out of
          the page's way, and SidebarProvider restores their last choice. */}
      <SidebarProvider
        defaultOpen={false}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <NavSidebar />
        <SidebarInset className="min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PanelErrorBoundary label="this screen">
              {children}
            </PanelErrorBoundary>
          </div>
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
