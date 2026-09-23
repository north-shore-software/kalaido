import type { Story } from "@ladle/react";
import {
  ClockCounterClockwise,
  FileText,
  Palette,
  SquaresFour,
  Waves,
} from "@phosphor-icons/react";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import { navSidebarTransitions } from "./nav-sidebar.transitions.ts";
import { SidebarNav, type SidebarNavItem } from "./sidebar-nav.tsx";

export default { title: "Layout / Sidebar Nav" };

const mockItems: readonly SidebarNavItem[] = [
  {
    title: "Dashboard",
    transition: navSidebarTransitions.transitions.openDashboard,
    icon: SquaresFour,
  },
  {
    title: "Projections",
    transition: navSidebarTransitions.transitions.openProjections,
    icon: FileText,
  },
  {
    title: "Reflections",
    transition: navSidebarTransitions.transitions.openReflections,
    icon: ClockCounterClockwise,
  },
  {
    title: "Colours",
    transition: navSidebarTransitions.transitions.openColours,
    icon: Palette,
  },
  {
    title: "Fragments",
    transition: navSidebarTransitions.transitions.openFragments,
    icon: Waves,
  },
];

export const Default: Story = () => (
  <SidebarProvider>
    <div className="w-[240px] border-r border-line h-screen bg-sidebar">
      <SidebarNav items={mockItems} />
    </div>
  </SidebarProvider>
);
