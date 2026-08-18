import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { TransitionDef } from "@/routes/route-kit";
import { pathFor, type SectionId, sectionForRoute } from "@/routes/registry";
import { RouteLink } from "@/routes/route-link";

export interface SidebarNavItem {
  title: string;
  transition: TransitionDef;
  icon: LucideIcon;
}

export const RAIL_ICON_CLASS =
  "size-4 [stroke-width:1.5] group-data-[collapsible=icon]:size-6.5";

const DEST_ACTIVE_CLASS: Record<SectionId, string> = {
  dashboard:
    "hover:border-l-cyan hover:bg-cyan-wash hover:text-fg-2 data-active:border-l-cyan data-active:text-cyan-ink data-active:hover:text-cyan-ink",
  chat:
    "hover:border-l-yellow hover:bg-yellow-wash hover:text-fg-2 data-active:border-l-yellow data-active:text-yellow-ink data-active:hover:text-yellow-ink",
  projections:
    "hover:border-l-[#4ade80] hover:bg-[rgb(74_222_128/0.08)] hover:text-fg-2 data-active:border-l-[#4ade80] data-active:text-[#4ade80] data-active:hover:text-[#4ade80]",
  reflections:
    "hover:border-l-[#c084fc] hover:bg-[rgb(192_132_252/0.08)] hover:text-fg-2 data-active:border-l-[#c084fc] data-active:text-[#c084fc] data-active:hover:text-[#c084fc]",
  colours:
    "hover:border-l-[#fda4af] hover:bg-[rgb(253_164_175/0.08)] hover:text-fg-2 data-active:border-l-[#fda4af] data-active:text-[#fda4af] data-active:hover:text-[#fda4af]",
  fragments:
    "hover:border-l-[#a3e635] hover:bg-[rgb(163_230_53/0.08)] hover:text-fg-2 data-active:border-l-[#a3e635] data-active:text-[#a3e635] data-active:hover:text-[#a3e635]",
  connections:
    "hover:border-l-fg-2 hover:bg-surface-2 hover:text-fg-2 data-active:border-l-fg-2 data-active:text-fg-2 data-active:hover:text-fg-2",
  settings:
    "hover:border-l-fg-2 hover:bg-surface-2 hover:text-fg-2 data-active:border-l-fg-2 data-active:text-fg-2 data-active:hover:text-fg-2",
  onboarding:
    "hover:border-l-cyan hover:bg-cyan-wash hover:text-fg-2 data-active:border-l-cyan data-active:text-cyan-ink data-active:hover:text-cyan-ink",
};

/**
 * A group of sidebar nav links. `/main` is matched exactly (it's the root); the
 * rest match their subtree so detail pages keep their nav item lit.
 */
export function SidebarNav({ items }: { items: readonly SidebarNavItem[] }) {
  const { pathname } = useLocation();
  const isActive = (transition: TransitionDef) => {
    const path = pathFor(transition.to);
    return path === "/main" ? pathname === "/main" : pathname.startsWith(path);
  };

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const Icon = item.icon;
          const destSection = sectionForRoute(item.transition.to);
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={isActive(item.transition)}
                className={DEST_ACTIVE_CLASS[destSection]}
                render={<RouteLink transition={item.transition} />}
              >
                <Icon className={RAIL_ICON_CLASS} />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
