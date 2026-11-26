import { createTauriHost } from "@kalaido/platform/tauri";
import { toast } from "sonner";

export function createAppHost() {
  return createTauriHost({
    variant: "mobile",
    onUnsupportedAction: (action) => {
      toast.info("Not supported outside Tauri", {
        description: action,
        id: `unsupported-tauri:${action}`,
      });
    },
  });
}
