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
    const result = await checkOllamaStatus();
    // An IPC failure is indistinguishable from Ollama being down, as far as
    // anything the user can act on goes.
    setStatus(
      result.isOk() && result.value.reachable ? "reachable" : "unreachable",
    );
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-dashed p-3">
      <StatusDot status={status} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {status === "checking" && (
          <span className="text-xs text-muted-foreground">
            Checking for Ollama…
          </span>
        )}

        {status === "reachable" && <span className="text-xs">Ollama running</span>}

        {status === "unreachable" && (
          <>
            <span className="text-xs">
              Ollama not running — AI won&apos;t be available until it is
            </span>
            <button
              type="button"
              className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => void openSystemBrowser(OLLAMA_DOWNLOAD_URL)}
            >
              Download and set up Ollama
            </button>
          </>
        )}
      </div>

      {status !== "checking" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void check()}
          className="-my-1 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <RefreshCwIcon />
          Recheck
        </Button>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === "checking") {
    return <Spinner className="mt-0.5 size-3 shrink-0 text-muted-foreground" />;
  }

  if (status === "reachable") {
    return <CheckIcon className="mt-0.5 size-3 shrink-0 text-stable" />;
  }

  return (
    <span className="mt-1 size-2 shrink-0 rounded-full bg-critical" aria-hidden />
  );
}
