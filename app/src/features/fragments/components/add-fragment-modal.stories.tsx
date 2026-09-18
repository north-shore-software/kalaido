import type { Story } from "@ladle/react";
import { AddFragmentModal } from "./add-fragment-modal";

export default { title: "Fragments / AddFragmentModal" };

/** Saving posts to the sidecar; in the workbench it reports the failure. */
export const Open: Story = () => <AddFragmentModal open onClose={() => {}} />;
