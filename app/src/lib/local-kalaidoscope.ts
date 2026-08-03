import { startLocalKalaidoscope } from "@/api/app/local-scopes";
import { appState } from "@/hooks/use-app-state.ts";
import { createKalaidoscopeClient } from "@/api/kalaidoscope/client.ts";
import { setActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client.ts";
import { openKalaidoscope, setAppStage } from "@/hooks/app-state-actions.ts";

export async function switchLocalKalaidoscope(targetId: string) {
  const meta = appState.availableKalaidoscopes.find((k) => k.id === targetId);
  if (!meta) {
    console.error("Workspace metadata not found:", targetId);
    setAppStage({ stage: "kalaidoscope_load_error" });
    return;
  }

  setAppStage({ stage: "kalaidoscope_loading" });

  try {
    // cloud/local_net need no sidecar — the per-scope client connects directly.
    if (meta.type === "local_file") {
      const startResult = await startLocalKalaidoscope(meta.locator);
      if (startResult.isErr()) throw startResult.error;
    }

    // The sidecar (if any) is up by now, so creating the client is cheap and
    // `kalaidoscope_open` means "client ready".
    setActiveKalaidoscopeClient(await createKalaidoscopeClient(meta));

    openKalaidoscope(targetId);
  } catch (error) {
    console.error("Failed to switch kalaidoscope:", error);
    setActiveKalaidoscopeClient(null);
    setAppStage({ stage: "kalaidoscope_load_error" });
  }
}
