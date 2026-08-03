import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { TransitionDef } from "@/routes/route-kit";
import { pathFor } from "@/routes/registry";
import { RouteLink } from "@/routes/route-link";

export interface SidebarNavItem {
  title: string;
  transition: TransitionDef;
  icon: LucideIcon;
}

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
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={isActive(item.transition)}
                render={<RouteLink transition={item.transition} />}
              >
                <Icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
