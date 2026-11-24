import { toast } from "sonner";
import { checkForUpdate, installPendingUpdate } from "@/api/app/updater.ts";

/**
 * Checks for an app update and offers it in a toast that stays until acted on.
 * Non-interactive checks (launch) stay silent unless an update is available.
 */
export async function checkForUpdatesAndPrompt(
  interactive: boolean,
): Promise<void> {
  const res = await checkForUpdate();
  if (res.isErr()) {
    if (interactive) {
      toast.error("Failed to check for updates", {
        description: res.error.message,
      });
    }
    return;
  }
  const update = res.value;
  if (!update) {
    if (interactive) {
      toast.info("Kalaido is up to date");
    }
    return;
  }
  toast.info(`Kalaido v${update.version} is available`, {
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: "Update & Restart",
      onClick: async () => {
        const loadingToast = toast.loading(
          "Downloading and installing update…",
        );
        const installRes = await installPendingUpdate();
        toast.dismiss(loadingToast);
        if (installRes.isErr()) {
          toast.error("Failed to install update", {
            description: installRes.error.message,
          });
        }
      },
    },
  });
}
