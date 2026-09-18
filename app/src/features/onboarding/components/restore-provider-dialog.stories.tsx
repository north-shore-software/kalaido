import type { Story } from "@ladle/react";
import { RestoreProviderDialog } from "./restore-provider-dialog";

export default { title: "Onboarding / RestoreProviderDialog" };

/** Continue validates the key against the host; here it fails inline. */
export const Open: Story = () => (
  <RestoreProviderDialog open onConfirm={() => {}} onCancel={() => {}} />
);
