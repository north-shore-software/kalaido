import {
  ClockCounterClockwiseIcon,
  FileTextIcon,
  PaletteIcon,
  SquaresFourIcon,
  WavesIcon,
} from "@phosphor-icons/react";
import type { Story } from "@ladle/react";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import { navSidebarTransitions } from "./nav-sidebar.transitions.ts";
import { SidebarNav, type SidebarNavItem } from "./sidebar-nav.tsx";

export default { title: "Layout / Sidebar Nav" };

const mockItems: readonly SidebarNavItem[] = [
  {
    title: "Dashboard",
    transition: navSidebarTransitions.transitions.openDashboard,
    icon: SquaresFourIcon,
  },
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

export const Default: Story = () => (
  <SidebarProvider>
    <div className="w-[240px] border-r border-line h-screen bg-sidebar">
      <SidebarNav items={mockItems} />
    </div>
  </SidebarProvider>
);
