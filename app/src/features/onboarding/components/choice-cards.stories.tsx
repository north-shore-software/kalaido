import type { Story } from "@ladle/react";
import {
  ArchiveIcon,
  CloudIcon,
  FolderInputIcon,
  PlusIcon,
} from "lucide-react";
import { PrimaryChoice, SecondaryChoice } from "./choice-cards";

export default { title: "Onboarding / Choice cards" };

export const Landing: Story = () => (
  <div
    data-section="onboarding"
    className="flex max-w-2xl flex-col gap-3 bg-background p-8"
  >
    <PrimaryChoice
      icon={<FolderInputIcon className="size-6" />}
      title="Import your notes"
      description="Bring in documents, notes or an email archive and let Kalaido organise them."
      onClick={() => {}}
    />
    <SecondaryChoice
      icon={<PlusIcon className="size-4" />}
      title="Start from blank"
      description="An empty local or cloud workspace."
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
