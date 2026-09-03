import type { Story } from "@ladle/react";
import PocketBase from "pocketbase";
import type { TypedPocketBase } from "@/api/kalaidoscope/types.ts";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client.ts";
import Colours from "./Colours";

export default { title: "Pages / Colours" };

export const EmptyAndLoadingState: Story = () => {
  const mockClient = new PocketBase("http://127.0.0.1:9999");
  return (
    <KalaidoscopeClientContext.Provider value={mockClient as TypedPocketBase}>
      <Colours />
    </KalaidoscopeClientContext.Provider>
  );
};
