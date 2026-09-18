import type { Story } from "@ladle/react";
import { AppearanceSection } from "./appearance-section";

export default { title: "Settings / AppearanceSection" };

export const Default: Story = () => (
  <div className="max-w-2xl bg-background p-6">
    <AppearanceSection />
  </div>
);
