import type { Story } from "@ladle/react";
import { ArchiveIcon, CloudIcon, PlusIcon } from "lucide-react";
import { PrimaryChoice, SecondaryChoice } from "./choice-cards";

export default { title: "Onboarding / Choice cards" };

export const Landing: Story = () => (
  <div
    data-section="onboarding"
    className="flex max-w-2xl flex-col gap-3 bg-background p-8"
  >
    <PrimaryChoice
      icon={<PlusIcon className="size-6" />}
      title="Create New Workspace"
      description="create your first kalaidoscope, start from blank or import your notes"
      onClick={() => {}}
    />
    <div className="grid gap-3 sm:grid-cols-2">
      <SecondaryChoice
        icon={<CloudIcon className="size-4" />}
        title="Log in to Cloud"
        description="Access cloud workspaces and sync across devices."
        onClick={() => {}}
      />
      <SecondaryChoice
        icon={<ArchiveIcon className="size-4" />}
        title="Restore Workspace"
        description="Restore a workspace backup from a .zip file."
        disabled
        onClick={() => {}}
      />
    </div>
  </div>
);
