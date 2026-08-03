import type { ComponentProps } from "react";
import {
  ArrowLeftRightIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  PaletteIcon,
  PanelLeftIcon,
  WavesIcon,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { RouteLink } from "@/routes/route-link";
import { navSidebarTransitions } from "./nav-sidebar.transitions";

import { openAddFragmentModal } from "@/hooks/app-state-actions.ts";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavKalaidoscopeSwitcher } from "@/features/create-kalaidoscope";
import {
  SidebarNav,
  type SidebarNavItem,
} from "@/components/layout/sidebar-nav";

const DASH_NAV: readonly SidebarNavItem[] = [
  {
    title: "Dashboard",
    transition: navSidebarTransitions.transitions.openDashboard,
    icon: LayoutDashboardIcon,
  },
];

const WORKSPACE_NAV: readonly SidebarNavItem[] = [
  {
    title: "Projections",
    transition: navSidebarTransitions.transitions.openProjections,
    icon: FileTextIcon,
  },
  {
    title: "Reflections",
    transition: navSidebarTransitions.transitions.openReflections,
    icon: HistoryIcon,
  },
  {
    title: "Colours",
    transition: navSidebarTransitions.transitions.openColours,
    icon: PaletteIcon,
  },
  {
    title: "Fragments",
    transition: navSidebarTransitions.transitions.openFragments,
    icon: WavesIcon,
  },
];

/** Accent treatment shared by the write-actions so they read as deliberate
 *  action buttons rather than navigation links. */
const ACTION_CLASS =
  "text-action-ink hover:bg-action-wash hover:text-action-ink active:bg-action-wash active:text-action-ink data-active:bg-action-wash data-active:text-action-ink";

/**
 * Write-actions create new data in the workspace, grouped together and
 * accented so they stay visually distinct from the read-only navigation above
 * the separator.
 */
function NavActions() {
  const { pathname } = useLocation();
  const openAddNote = () => {
    openAddFragmentModal();
  };
  return (
    <SidebarGroup className="py-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Chat"
            isActive={pathname.startsWith("/chat")}
            className={ACTION_CLASS}
            render={
              <RouteLink
                transition={navSidebarTransitions.transitions.openChat}
              />
            }
          >
            <MessagesSquareIcon />
            <span>Chat</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Add Note"
            className={ACTION_CLASS}
            onClick={openAddNote}
          >
            <NotebookPenIcon />
            <span>Add Note</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Connections — the outward-facing hub (import today; export and live sync
 * later). A neutral destination kept low-prominence beneath the action cluster.
 */
function NavConnections() {
  const { pathname } = useLocation();
  return (
    <SidebarGroup className="py-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Connections"
            isActive={pathname.startsWith("/connections")}
            render={
              <RouteLink
                transition={navSidebarTransitions.transitions.openConnections}
              />
            }
          >
            <ArrowLeftRightIcon />
            <span>Connections</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function SidebarToggleButton() {
  const { toggleSidebar } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={toggleSidebar} tooltip="Toggle sidebar">
          <PanelLeftIcon />
          <span>Collapse</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function NavSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-2.5 pt-4">
        <NavKalaidoscopeSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav items={DASH_NAV} />
        <SidebarSeparator />
        <NavActions />
        <SidebarSeparator />
        <SidebarNav items={WORKSPACE_NAV} />
        <SidebarSeparator />
        <NavConnections />
      </SidebarContent>
      <SidebarFooter>
        <SidebarToggleButton />
      </SidebarFooter>
    </Sidebar>
  );
}
