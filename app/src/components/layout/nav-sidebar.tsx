import {
  ArrowsLeftRightIcon,
  ChatsIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  GearIcon,
  MapTrifoldIcon,
  PaletteIcon,
  PlusCircleIcon,
  PulseIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  WavesIcon,
} from "@phosphor-icons/react";
import type { ComponentProps } from "react";
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
import { cn } from "@/lib/css-utils";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { pathFor } from "@/routes/registry";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useCurrentPathname } from "@/routes/use-current-pathname";
import { navSidebarTransitions } from "./nav-sidebar.transitions";

/** Where you start: the two destinations you return to, not places you browse. */
const MAIN_NAV: readonly SidebarNavItem[] = [
  {
    title: "Dashboard",
    transition: navSidebarTransitions.transitions.openDashboard,
    icon: SquaresFourIcon,
  },
  {
    title: "Explore",
    transition: navSidebarTransitions.transitions.openExplore,
    icon: ChatsIcon,
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
    icon: ClockCounterClockwiseIcon,
  },
  {
    title: "Map",
    transition: navSidebarTransitions.transitions.openMap,
    icon: MapTrifoldIcon,
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

function CaptureButton() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="New Fragment"
        onClick={() => openAddFragmentModal()}
        className="text-cyan hover:border-l-cyan hover:bg-cyan-wash hover:text-cyan"
      >
        <PlusCircleIcon
          weight="fill"
          className={cn(RAIL_ICON_CLASS, "text-cyan")}
        />
        <span>New Fragment</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Connections — the outward-facing hub (import today; export and live sync
 * later). Gated with the rest of the feature: while the flag is off the route
 * is unreachable too, so there is nothing to link to.
 */
function NavConnections() {
  const pathname = useCurrentPathname();
  const { go } = useAppNavigate();
  return (
    <>
      <SidebarSeparator />
      <SidebarGroup className="py-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Connections"
              isActive={pathname.startsWith(pathFor("connections"))}
              className={NEUTRAL_DEST_CLASS}
              onClick={() =>
                go(navSidebarTransitions.transitions.openConnections)
              }
            >
              <ArrowsLeftRightIcon className={RAIL_ICON_CLASS} />
              <span>Connections</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

function StatusButton() {
  const pathname = useCurrentPathname();
  const { go } = useAppNavigate();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Status"
        isActive={pathname.startsWith(pathFor("status"))}
        className={NEUTRAL_DEST_CLASS}
        onClick={() => go(navSidebarTransitions.transitions.openStatus)}
      >
        <PulseIcon />
        <span>Status</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SettingsButton() {
  const pathname = useCurrentPathname();
  const { go } = useAppNavigate();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Settings"
        isActive={pathname.startsWith(pathFor("settings"))}
        className={NEUTRAL_DEST_CLASS}
        onClick={() => go(navSidebarTransitions.transitions.openSettings)}
      >
        <GearIcon />
        <span>Settings</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarToggleButton() {
  const { toggleSidebar, state } = useSidebar();
  const label = state === "collapsed" ? "Expand sidebar" : "Collapse sidebar";
  return (
    <SidebarMenuItem data-sidebar-control="toggle">
      <SidebarMenuButton onClick={toggleSidebar} tooltip={label}>
        <SidebarSimpleIcon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function NavSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="pt-4">
        <NavKalaidoscopeSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav items={MAIN_NAV} />
        <SidebarSeparator />
        <SidebarNav items={WORKSPACE_NAV}>
          <CaptureButton />
        </SidebarNav>
        {isFeatureEnabled("connections") && <NavConnections />}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <StatusButton />
          <SettingsButton />
          <SidebarToggleButton />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
