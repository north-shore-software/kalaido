import { Navigate } from "react-router-dom";
import { type AppStage, desktopScope } from "@/state/app-state.ts";
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

export type AppRedirectProps<Id extends RouteId> = {
  transition: TransitionDef<Id>;
  replace?: boolean;
} & ParamsArg<Id> &
  StateArg<Id>;

/** Declarative counterpart of useAppNavigate().go — for render-time redirects. */
export function AppRedirect<Id extends RouteId>({
  transition,
  params,
  state,
  replace = true,
}: AppRedirectProps<Id>) {
  const target = routeById(transition.to);
  const currentStage = desktopScope.state.appStage as AppStage;
  const missing = missingScope(
    target,
    currentScope({ appStage: currentStage }),
  );
  if (missing.length > 0) {
    console.error(
      `[nav] blocked redirect to "${target.id}" (${transition.trigger}) — missing scope: ${missing.join(", ")}`,
    );
    return <Navigate to={pathFor(stageEntryRoute(currentStage))} replace />;
  }
  return (
    <Navigate
      to={buildRoutePath(target, params as AnyParams | undefined)}
      state={state}
      replace={replace}
    />
  );
}
