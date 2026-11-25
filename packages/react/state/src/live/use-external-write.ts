import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toError } from "#errors";
import { invalidateLiveTags } from "./registry";
import type {
  ExternalWriteDef,
  ExternalWriteHandle,
  ValidWriteReturn,
  WriteOutcome,
  WriteReturn,
  WriteStatus,
} from "./types";

/**
 * Paired async command hook for writes to persistent external stores.
 *
 * - Never returns updated entity payloads (type-enforced via `WriteReturn`:
 *   `void` for updates/deletes/actions, `{ id }` or `{ ids }` for creates).
 * - Defaults to `concurrency: "ignore"`, returning `{ status: "ignored" }`
 *   early if a write is already in flight.
 * - Awaits paired `invalidates` live-read tags on success before resolving so
 *   non-push reads stay transparently live.
 */
export function useExternalWrite<TArgs = void, TOut extends WriteReturn = void>(
  def: ExternalWriteDef<TArgs, TOut> & NoInfer<ValidWriteReturn<TOut>>,
): ExternalWriteHandle<TArgs, TOut> {
  const defRef = useRef<ExternalWriteDef<TArgs, TOut>>(def);
  useLayoutEffect(() => {
    defRef.current = def;
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const inFlightRef = useRef(0);
  const [status, setStatus] = useState<WriteStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    if (!mountedRef.current || inFlightRef.current > 0) return;
    setStatus("idle");
    setError(null);
  }, []);

  const run = useCallback(
    async (
      // biome-ignore lint/suspicious/noConfusingVoidType: distinguishes zero-argument writes (TArgs = void) from parameterized writes
      ...callArgs: [TArgs] extends [void] ? [] : [args: TArgs]
    ): Promise<WriteOutcome<TOut>> => {
      const current = defRef.current;
      const concurrency = current.concurrency ?? "ignore";

      if (concurrency === "ignore" && inFlightRef.current > 0) {
        return { status: "ignored" };
      }

      const args = callArgs[0] as TArgs;
      inFlightRef.current += 1;
      if (mountedRef.current) {
        setStatus("pending");
        setError(null);
      }

      try {
        const result = await current.execute(args);
        if (result.isErr()) {
          inFlightRef.current -= 1;
          if (mountedRef.current) {
            setError(result.error);
            if (inFlightRef.current === 0) {
              setStatus("error");
            }
          }
          return { status: "error", error: result.error };
        }

        const tags =
          typeof current.invalidates === "function"
            ? current.invalidates(args)
            : (current.invalidates ?? []);

        if (tags.length > 0) {
          await invalidateLiveTags(tags);
        }

        inFlightRef.current -= 1;
        if (mountedRef.current) {
          setError(null);
          if (inFlightRef.current === 0) {
            setStatus("success");
          }
        }

        const payload = result.value;
        if (payload && typeof payload === "object") {
          if ("id" in payload && typeof payload.id === "string") {
            return {
              status: "success",
              id: payload.id,
            } as unknown as WriteOutcome<TOut>;
          }
          if ("ids" in payload && Array.isArray(payload.ids)) {
            return {
              status: "success",
              ids: payload.ids as readonly string[],
            } as unknown as WriteOutcome<TOut>;
          }
        }
        return { status: "success" } as unknown as WriteOutcome<TOut>;
      } catch (e) {
        const err = toError(e);
        inFlightRef.current -= 1;
        if (mountedRef.current) {
          setError(err);
          if (inFlightRef.current === 0) {
            setStatus("error");
          }
        }
        return { status: "error", error: err };
      }
    },
    [],
  );

  return {
    run,
    status,
    isPending: status === "pending",
    error,
    reset,
  };
}
