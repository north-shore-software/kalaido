import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { checkOllamaStatus } from "@/api/app/ollama-status.ts";
import { openSystemBrowser } from "@/api/app/os-integrations.ts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

type Status = "checking" | "reachable" | "unreachable";

/**
 * Live Ollama reachability for the setup form.
 *
 * Deliberately advisory: a workspace can always be created without Ollama
 * running, because installing it afterwards costs the user nothing and needs no
 * change to the workspace. The check is the one thing the form can tell them
 * that they cannot easily find out themselves.
 */
export function OllamaSetupStatus() {
  const [status, setStatus] = useState<Status>("checking");

  const check = useCallback(async () => {
    setStatus("checking");
    const [result] = await Promise.all([
      checkOllamaStatus(),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
    setStatus(
      result.isOk() && result.value.reachable ? "reachable" : "unreachable",
    );
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed p-3.5">
      <StatusDot status={status} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {status === "checking" && (
          <span className="text-body-sm text-muted-foreground">
            Checking for Ollama…
          </span>
        )}

        {status === "reachable" && (
          <span className="text-body-sm font-medium text-foreground">
            Ollama running
          </span>
        )}

        {status === "unreachable" && (
          <>
            <span className="text-body-sm text-muted-foreground">
              Ollama not running — AI won&apos;t be available until it is
            </span>
            <button
              type="button"
              className="w-fit text-meta text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => void openSystemBrowser(OLLAMA_DOWNLOAD_URL)}
            >
              Download and set up Ollama
            </button>
          </>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={status === "checking"}
        onClick={() => void check()}
        className="shrink-0 gap-1.5 transition-colors hover:border-cyan-edge hover:bg-cyan-wash hover:text-cyan"
      >
        {status === "checking" ? (
          <>
            <Spinner className="size-3.5" />
            Checking…
          </>
        ) : (
          <>
            <RefreshCwIcon className="size-3.5" />
            Recheck
          </>
        )}
      </Button>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === "checking") {
    return <Spinner className="size-4 shrink-0 text-muted-foreground" />;
  }

  if (status === "reachable") {
    return <CheckIcon className="size-4 shrink-0 text-stable" />;
  }

  return (
    <span
      className="size-2.5 shrink-0 rounded-full bg-critical"
      aria-hidden
    />
  );
}
