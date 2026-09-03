import {
  ArrowLeftRightIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  PaletteIcon,
  PanelLeftIcon,
  SettingsIcon,
  WavesIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { useLocation } from "react-router-dom";
import {
  NEUTRAL_DEST_CLASS,
  RAIL_ICON_CLASS,
  SidebarNav,
  type SidebarNavItem,
} from "@/components/layout/sidebar-nav";
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
import { openAddFragmentModal } from "@/hooks/app-state-actions.ts";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { RouteLink } from "@/routes/route-link";
import { navSidebarTransitions } from "./nav-sidebar.transitions";

/** Where you start: the two destinations you return to, not places you browse. */
const MAIN_NAV: readonly SidebarNavItem[] = [
  {
    title: "Dashboard",
    transition: navSidebarTransitions.transitions.openDashboard,
    icon: LayoutDashboardIcon,
  },
  {
    title: "Chat",
    transition: navSidebarTransitions.transitions.openChat,
    icon: MessagesSquareIcon,
  },
];

/** The entity sections — browsing what the workspace already holds. */
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

const ACTION_CLASS =
  "text-fg-2 hover:border-l-cyan hover:bg-cyan-wash hover:text-fg-2 active:bg-cyan-wash active:text-fg-2 data-active:border-l-cyan data-active:bg-cyan-wash data-active:text-fg-2";

/**
 * Capture sits above the navigation and alone in its zone — getting a thought
 * out of your head is the shell's first job, and it must not read as a
 * destination.
 */
function NavCapture() {
  return (
    <SidebarGroup className="py-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Capture"
            className={ACTION_CLASS}
            onClick={() => openAddFragmentModal()}
          >
            <NotebookPenIcon className={RAIL_ICON_CLASS} />
            <span>Capture</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Connections — the outward-facing hub (import today; export and live sync
 * later). Gated with the rest of the feature: while the flag is off the route
 * is unreachable too, so there is nothing to link to.
 */
function NavConnections() {
  const { pathname } = useLocation();
  return (
    <>
      <SidebarSeparator />
      <SidebarGroup className="py-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Connections"
              isActive={pathname.startsWith("/connections")}
              className={NEUTRAL_DEST_CLASS}
              render={
                <RouteLink
                  transition={navSidebarTransitions.transitions.openConnections}
                />
              }
            >
              <ArrowLeftRightIcon className={RAIL_ICON_CLASS} />
              <span>Connections</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

function SettingsButton() {
  const { pathname } = useLocation();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Settings"
        isActive={pathname.startsWith("/settings")}
        className={NEUTRAL_DEST_CLASS}
        render={
          <RouteLink
            transition={navSidebarTransitions.transitions.openSettings}
          />
        }
      >
        <SettingsIcon />
        <span>Settings</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * The rail opens collapsed, so this is the only visible way back to the labels
 * — it has to stay on screen, and its label has to describe what the click
 * does rather than what the sidebar currently is.
 */
function SidebarToggleButton() {
  const { toggleSidebar, state } = useSidebar();
  const label = state === "collapsed" ? "Expand sidebar" : "Collapse sidebar";
  return (
    <SidebarMenuItem data-sidebar-control="toggle">
      <SidebarMenuButton onClick={toggleSidebar} tooltip={label}>
        <PanelLeftIcon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function NavSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-2.5 pt-4">
        <NavKalaidoscopeSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavCapture />
        <SidebarSeparator />
        <SidebarNav items={MAIN_NAV} />
        <SidebarSeparator />
        <SidebarNav items={WORKSPACE_NAV} />
        {isFeatureEnabled("connections") && <NavConnections />}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SettingsButton />
          <SidebarToggleButton />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
