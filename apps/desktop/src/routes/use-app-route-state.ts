import { useLocation } from "react-router-dom";
import type { StateOf } from "./route-contracts";
import type { RouteId } from "./route-ids";

/**
 * The router state the mounted screen was navigated to with, typed by its
 * route id (see `RouteContracts`). Missing state reads as `{}`: every state
 * contract is all-optional, so a screen reached by a plain `go(...)` sees the
 * same shape with nothing set.
 */
export function useAppRouteState<Id extends RouteId>(): NonNullable<
  StateOf<Id>
> {
  return (useLocation().state ?? {}) as NonNullable<StateOf<Id>>;
}
