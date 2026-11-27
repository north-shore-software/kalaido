import {
  createDebouncedActionReporter,
  type DesktopHostAdapter,
  getHost,
  setHost,
} from "@kalaido/platform";
import { createDesktopTauriHost } from "@kalaido/platform/tauri-desktop";
import { toast } from "sonner";

export function createAppHost(): DesktopHostAdapter {
  const reporter = createDebouncedActionReporter((batch) => {
    toast.info(batch.title, {
      id: "unsupported-tauri",
      description: batch.description,
      onDismiss: batch.onClose,
      onAutoClose: batch.onClose,
    });
  });

  return createDesktopTauriHost({
    onUnsupportedAction: reporter.report,
  });
}

export function getDesktopHost(): DesktopHostAdapter {
  let host: DesktopHostAdapter;
  try {
    host = getHost() as DesktopHostAdapter;
  } catch {
    host = createAppHost();
    setHost(host);
    return host;
  }
  if (!host.sidecar) {
    throw new Error("Active HostAdapter is not a DesktopHostAdapter");
  }
  return host;
}
