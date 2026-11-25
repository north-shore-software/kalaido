import { PageHeader } from "@kalaido/components/page-header";
import { PanelErrorBoundary } from "@kalaido/components/panel-error-boundary";
import { AddFragmentModal } from "@kalaido/features/fragments";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import {
  PageBody,
  PageCard,
  PaneHeader,
} from "@kalaido/primitives/layout/page-primitives";
import {
  SidebarInset,
  SidebarProvider,
} from "@kalaido/primitives/shadcn/sidebar";
import { useScope, useScopeState } from "@kalaido/state/scope";
import type { ReactNode } from "react";
import { NavSidebar } from "@/components/layout/nav-sidebar";
import { UtilityBar } from "@/components/layout/utility-bar";
import { desktopImportAdapter } from "@/features/import/desktop-import-adapter";
import { DesktopScopeContext } from "@/state/app-state";

export { PageBody, PageCard, PageHeader, PaneHeader };

export function PageLayout({ children }: { children: ReactNode }) {
  const root = useScopeContext(DesktopScopeContext);
  const layoutScope = useScope({
    from: root,
    state: ["sidebarOpen", "addFragmentModalOpen"],
    events: ["setSidebarOpen", "setAddFragmentModalOpen"],
  });
  const { sidebarOpen, addFragmentModalOpen } = useScopeState(layoutScope);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={(open) => {
          void layoutScope.dispatch({ type: "setSidebarOpen", open });
        }}
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
          void layoutScope.dispatch({
            type: "setAddFragmentModalOpen",
            open: false,
          });
        }}
        importAdapter={desktopImportAdapter}
      />
    </div>
  );
}
