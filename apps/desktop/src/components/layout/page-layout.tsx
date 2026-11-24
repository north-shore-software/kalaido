import { PageHeader } from "@kalaido/components/page-header";
import { PanelErrorBoundary } from "@kalaido/components/panel-error-boundary";
import {
  PageBody,
  PageCard,
  PaneHeader,
} from "@kalaido/primitives/layout/page-primitives";
import {
  SidebarInset,
  SidebarProvider,
} from "@kalaido/primitives/shadcn/sidebar";
import type { ReactNode } from "react";
import { useSnapshot } from "valtio/react";
import { NavSidebar } from "@/components/layout/nav-sidebar";
import { UtilityBar } from "@/components/layout/utility-bar";
import { AddFragmentModal } from "@/features/fragments";
import { closeAddFragmentModal } from "@/hooks/app-state-actions";
import { appState } from "@/hooks/use-app-state";

export { PageBody, PageCard, PageHeader, PaneHeader };

export function PageLayout({ children }: { children: ReactNode }) {
  const { addFragmentModalOpen } = useSnapshot(appState);
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
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
