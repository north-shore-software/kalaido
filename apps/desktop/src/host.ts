import { createTauriHost } from "@kalaido/platform/tauri";
import { getFeedbackDiagnostics } from "@/api/app/feedback";

export function createAppHost() {
  return createTauriHost({
    variant: "desktop",
    collectDiagnostics: getFeedbackDiagnostics,
  });
}
