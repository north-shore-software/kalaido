import { createDebouncedActionReporter } from "@kalaido/platform";
import { createTauriHost } from "@kalaido/platform/tauri";
import { toast } from "sonner";

export function createAppHost() {
  const reporter = createDebouncedActionReporter((batch) => {
    toast.info(batch.title, {
      id: "unsupported-tauri",
      description: batch.description,
      onDismiss: batch.onClose,
      onAutoClose: batch.onClose,
    });
  });

  return createTauriHost({
    variant: "mobile",
    onUnsupportedAction: reporter.report,
  });
}
