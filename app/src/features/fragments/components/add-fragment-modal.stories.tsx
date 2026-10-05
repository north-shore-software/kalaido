import type { Story } from "@ladle/react";
import PocketBase from "pocketbase";
import type { TypedPocketBase } from "@/api/kalaidoscope/types.ts";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client.ts";
import { AddFragmentModal } from "./add-fragment-modal";

export default { title: "Fragments / AddFragmentModal" };

/**
 * Saving posts to the sidecar; in the workbench it reports the failure. The
 * import tab's colour list reads from a client that answers nothing.
 */
export const Open: Story = () => {
  const mockClient = new PocketBase("http://127.0.0.1:9999");
  return (
    <KalaidoscopeClientContext.Provider value={mockClient as TypedPocketBase}>
      <AddFragmentModal open onClose={() => {}} />
    </KalaidoscopeClientContext.Provider>
  );
};
