import type { Story } from "@ladle/react";
import PocketBase from "pocketbase";
import type { TypedPocketBase } from "@/api/kalaidoscope/types.ts";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client.ts";
import { ImportNotesDialog } from "./import-notes-dialog";

export default { title: "Dashboard / ImportNotesDialog" };

/**
 * Choosing a file opens the host's picker; the workbench has none. The colour
 * list reads from a client that answers nothing, so it stays empty.
 */
export const Open: Story = () => {
  const mockClient = new PocketBase("http://127.0.0.1:9999");
  return (
    <KalaidoscopeClientContext.Provider value={mockClient as TypedPocketBase}>
      <ImportNotesDialog open onClose={() => {}} onImportSuccess={() => {}} />
    </KalaidoscopeClientContext.Provider>
  );
};
