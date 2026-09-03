import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { pathFor, type SectionId, sectionForRoute } from "@/routes/registry";
import type { TransitionDef } from "@/routes/route-kit";
import { RouteLink } from "@/routes/route-link";

export interface SidebarNavItem {
  title: string;
  transition: TransitionDef;
  icon: LucideIcon;
}

export const RAIL_ICON_CLASS =
  "size-4 [stroke-width:1.5] group-data-[collapsible=icon]:size-6.5";

/** Neutral destinations (and the standalone Connections/Settings rail items):
 *  fg-2 plays the accent, per the §4 monochrome rule. */
export const NEUTRAL_DEST_CLASS =
  "hover:border-l-fg-2 hover:bg-surface-2 hover:text-fg-2 data-active:border-l-fg-2 data-active:text-fg-2 data-active:hover:text-fg-2";

const DEST_ACTIVE_CLASS: Record<SectionId, string> = {
  dashboard:
    "hover:border-l-cyan hover:bg-cyan-wash hover:text-fg-2 data-active:border-l-cyan data-active:text-cyan-ink data-active:hover:text-cyan-ink",
  chat: "hover:border-l-yellow hover:bg-yellow-wash hover:text-fg-2 data-active:border-l-yellow data-active:text-yellow-ink data-active:hover:text-yellow-ink",
  projections:
    "hover:border-l-green hover:bg-green-wash hover:text-fg-2 data-active:border-l-green data-active:text-green-ink data-active:hover:text-green-ink",
  reflections:
    "hover:border-l-violet hover:bg-violet-wash hover:text-fg-2 data-active:border-l-violet data-active:text-violet-ink data-active:hover:text-violet-ink",
  colours:
    "hover:border-l-blush hover:bg-blush-wash hover:text-fg-2 data-active:border-l-blush data-active:text-blush-ink data-active:hover:text-blush-ink",
  fragments:
    "hover:border-l-lime hover:bg-lime-wash hover:text-fg-2 data-active:border-l-lime data-active:text-lime-ink data-active:hover:text-lime-ink",
  connections: NEUTRAL_DEST_CLASS,
  settings: NEUTRAL_DEST_CLASS,
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
