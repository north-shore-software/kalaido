import { ChevronsUpDown, Plus } from "lucide-react";
import { useSnapshot } from "valtio/react";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { switcherTransitions } from "./nav-kalaidoscope-switcher.transitions";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Label, Mark } from "@/components/kalaido";
import { appState } from "@/hooks/use-app-state.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";

export function NavKalaidoscopeSwitcher() {
  const { go } = useAppNavigate();
  const { isMobile } = useSidebar();
  const { appStage, availableKalaidoscopes: kalaidoscopes } =
    useSnapshot(appState);
  const currentKalaidoscopeId =
    appStage.stage === "kalaidoscope_open"
      ? appStage.selectedKalaidoscopeId
      : null;
  const switching = appStage.stage === "kalaidoscope_loading";
  const current =
    kalaidoscopes.find((s) => s.id === currentKalaidoscopeId) ??
    kalaidoscopes[0];

  async function handleSelect(id: string) {
    if (id === currentKalaidoscopeId) return;
    // switchLocalKalaidoscope handles its own errors by setting kalaidoscope_load_error.
    await switchLocalKalaidoscope(id);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Mark className="size-7" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">
                    {current?.displayName ?? "…"}
                  </span>
                  <Label className="mt-0.5 text-[9px] leading-none">
                    Local
                  </Label>
                </div>
                <ChevronsUpDown className="ml-auto size-4 opacity-50" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-64"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Kalaidoscopes
              </DropdownMenuLabel>
              {kalaidoscopes.map((kalaidoscope, index) => (
                <DropdownMenuItem
                  key={kalaidoscope.id}
                  onClick={() => void handleSelect(kalaidoscope.id)}
                  disabled={switching}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <span className="text-xs font-medium">
                      {kalaidoscope.displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  {kalaidoscope.displayName}
                  {index < 9 && (
                    <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              onClick={() =>
                go(switcherTransitions.transitions.newKalaidoscope)
              }
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">
                New kalaidoscope
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
