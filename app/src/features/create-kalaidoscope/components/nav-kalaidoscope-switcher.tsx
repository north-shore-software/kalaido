import { CaretUpDownIcon, PlusIcon } from "@phosphor-icons/react";
import { useSnapshot } from "valtio/react";
import { Label, Mark } from "@/components/kalaido";
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
import { appState } from "@/hooks/use-app-state.ts";
import { cn } from "@/lib/css-utils";
import { kalaidoscopeTypeLabel } from "@/lib/labels";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { switcherTransitions } from "./nav-kalaidoscope-switcher.transitions";

const MENU_ITEM_CLASS =
  "h-[60px] cursor-pointer gap-3 px-3 normal-case tracking-normal hover:bg-cyan-wash hover:text-cyan focus:bg-cyan-wash focus:text-cyan data-[highlighted]:bg-cyan-wash data-[highlighted]:text-cyan";

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
                // Collapsed, the name beside the mark is gone and the mark
                // alone doesn't say which kalaidoscope you're in.
                tooltip={current?.displayName ?? "Kalaidoscope"}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Mark className="size-7" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-item font-semibold">
                    {current?.displayName ?? "…"}
                  </span>
                  <Label className="mt-0.5 text-[9px] leading-none">
                    Local
                  </Label>
                </div>
                <CaretUpDownIcon className="ml-auto size-4 opacity-50" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-72"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-label uppercase text-muted-foreground">
                Kalaidoscopes
              </DropdownMenuLabel>
              {kalaidoscopes.map((kalaidoscope, index) => {
                const isActive = kalaidoscope.id === currentKalaidoscopeId;
                return (
                  <DropdownMenuItem
                    key={kalaidoscope.id}
                    onClick={() => void handleSelect(kalaidoscope.id)}
                    disabled={switching}
                    className={MENU_ITEM_CLASS}
                  >
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-none border transition-colors",
                        isActive
                          ? "border-cyan-edge bg-cyan-veil text-cyan font-semibold"
                          : "border-line bg-surface-1 font-semibold text-fg-1 group-hover/dropdown-menu-item:border-cyan-edge group-hover/dropdown-menu-item:text-cyan group-data-[highlighted]/dropdown-menu-item:border-cyan-edge group-data-[highlighted]/dropdown-menu-item:text-cyan",
                      )}
                    >
                      <span className="text-item">
                        {kalaidoscope.displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
                      <span className="truncate text-item font-semibold text-fg-1 transition-colors group-hover/dropdown-menu-item:text-cyan group-data-[highlighted]/dropdown-menu-item:text-cyan">
                        {kalaidoscope.displayName}
                      </span>
                      <span className="truncate text-meta text-fg-4 transition-colors group-hover/dropdown-menu-item:text-cyan/70 group-data-[highlighted]/dropdown-menu-item:text-cyan/70">
                        {kalaidoscopeTypeLabel(kalaidoscope.type)}
                      </span>
                    </div>
                    {index < 9 && (
                      <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={MENU_ITEM_CLASS}
              onClick={() =>
                go(switcherTransitions.transitions.newKalaidoscope)
              }
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-none border border-dashed border-line bg-surface-1 text-fg-3 transition-colors group-hover/dropdown-menu-item:border-cyan-edge group-hover/dropdown-menu-item:text-cyan group-data-[highlighted]/dropdown-menu-item:border-cyan-edge group-data-[highlighted]/dropdown-menu-item:text-cyan">
                <PlusIcon className="size-4" />
              </div>
              <div className="flex flex-col justify-center leading-tight">
                <span className="text-item font-medium text-fg-2 transition-colors group-hover/dropdown-menu-item:text-cyan group-data-[highlighted]/dropdown-menu-item:text-cyan">
                  New kalaidoscope
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
