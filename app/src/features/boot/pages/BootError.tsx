import { TriangleAlert } from "lucide-react";
import { defineRoute } from "@/routes/route-kit";
import { bootErrorTransitions } from "./BootError.transitions";

/**
 * Full-screen fallback shown when the active kalaidoscope's local backend (the
 * PocketBase sidecar) fails to start — e.g. a failed migration. Without this the
 * app renders nothing, so this is the user's only way back to a working state.
 */
export default function BootError() {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-lg">
          <div className="mb-4 flex items-center gap-3">
            <TriangleAlert className="size-6 text-destructive" />
            <h1 className="text-lg font-semibold tracking-tight">
              This kalaidoscope failed to start
            </h1>
          </div>

          <p className="text-sm text-muted-foreground">
            Kalaido couldn&apos;t start the local backend for this kalaidoscope,
            so it can&apos;t load your data. This usually means the
            kalaidoscope&apos;s database is in a bad state. You can try again,
            or reset the app to start fresh.
          </p>
        </div>
      </div>
    </div>
  );
}

export const bootErrorRoute = defineRoute({
  id: "boot-error",
  path: "/boot-error",
  feature: "Boot",
  requiredScope: [],
  transitions: bootErrorTransitions,
  Component: BootError,
});
