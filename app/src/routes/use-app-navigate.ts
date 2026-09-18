import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { type AppStage, appState } from "@/hooks/use-app-state.ts";
import { pathFor, routeById } from "./registry";
import type { AnyParams, ParamsArg, StateArg } from "./route-contracts";
import type { RouteId } from "./route-ids";
import {
  buildRoutePath,
  currentScope,
  missingScope,
  stageEntryRoute,
  type TransitionDef,
} from "./route-kit";

/**
 * Options of a `go(...)` call, typed by the destination: `params` is required
 * when the destination has a required URL param, `state` is only offered when
 * the destination declares a state contract (see `RouteContracts`).
 */
export type GoOptions<Id extends RouteId> = {
  replace?: boolean;
} & ParamsArg<Id> &
  StateArg<Id>;

/** An object with no required keys — the probe for "may this be omitted?". */
type NoRequiredKeys = Record<string, never>;

/** The options tuple is optional as a whole only when nothing in it is required. */
type GoArgs<Id extends RouteId> = NoRequiredKeys extends GoOptions<Id>
  ? [opts?: GoOptions<Id>]
  : [opts: GoOptions<Id>];

/** The only sanctioned way to navigate. Every call names a declared transition. */
export function useAppNavigate() {
  const navigate = useNavigate();

  const go = useCallback(
    <Id extends RouteId>(
      transition: TransitionDef<Id>,
      ...[opts]: GoArgs<Id>
    ) => {
      const target = routeById(transition.to);
      const missing = missingScope(
        target,
        currentScope({ appStage: appState.appStage as AppStage }),
      );
      if (missing.length > 0) {
        console.error(
          `[nav] blocked transition to "${target.id}" (${transition.trigger}) — missing scope: ${missing.join(", ")}`,
        );
        navigate(pathFor(stageEntryRoute(appState.appStage as AppStage)), {
          replace: true,
        });
        return;
      }
      navigate(buildRoutePath(target, opts?.params as AnyParams | undefined), {
        replace: opts?.replace,
        state: opts?.state,
      });
    },
    [navigate],
  );

  /** History back (for explicit back buttons). Gatekeeper still applies at mount. */
  const goBack = useCallback(() => navigate(-1), [navigate]);

  return { go, goBack };
}
