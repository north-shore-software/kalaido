import type { Story } from "@ladle/react";
import { ImportNotesDialog } from "./import-notes-dialog";

export default { title: "Dashboard / ImportNotesDialog" };

/** Choosing a file opens the host's picker; the workbench has none. */
export const Open: Story = () => (
  <ImportNotesDialog open onClose={() => {}} onImportSuccess={() => {}} />
);
