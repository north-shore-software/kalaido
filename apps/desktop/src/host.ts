import { createTauriHost } from "@kalaido/platform/tauri";
import { notifyUnsupportedTauriAction } from "@/api/app/_invoke";
import { getFeedbackDiagnostics } from "@/api/app/feedback";

export function createAppHost() {
  return createTauriHost({
    variant: "desktop",
    collectDiagnostics: getFeedbackDiagnostics,
    onUnsupportedAction: notifyUnsupportedTauriAction,
  });
}
