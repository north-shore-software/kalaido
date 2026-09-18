import type { Story } from "@ladle/react";
import { DuplicateWorkspaceDialog } from "./duplicate-workspace-dialog";

export default { title: "Onboarding / DuplicateWorkspaceDialog" };

export const Open: Story = () => (
  <DuplicateWorkspaceDialog
    open
    existingName="Personal Journal"
    onConfirm={() => {}}
    onCancel={() => {}}
  />
);

export const Busy: Story = () => (
  <DuplicateWorkspaceDialog
    open
    busy
    existingName="Personal Journal"
    onConfirm={() => {}}
    onCancel={() => {}}
  />
);
