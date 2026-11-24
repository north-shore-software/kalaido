import { createTauriHost } from "@kalaido/platform/tauri";

export function createAppHost() {
  return createTauriHost({ variant: "mobile" });
}
