import type { Story } from "@ladle/react";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import { mockKalaidoscopes, seedKalaidoscopes } from "../fixtures";
import { NavKalaidoscopeSwitcher } from "./nav-kalaidoscope-switcher";

export default { title: "Create Kalaidoscope / NavKalaidoscopeSwitcher" };

export const Default: Story = () => {
  seedKalaidoscopes(mockKalaidoscopes, mockKalaidoscopes[0].id);
  return (
    <SidebarProvider>
      <div className="h-screen w-[240px] border-r border-line bg-sidebar p-2">
        <NavKalaidoscopeSwitcher />
      </div>
    </SidebarProvider>
  );
};
