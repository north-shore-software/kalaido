import { Link, type LinkProps } from "react-router-dom";
import { routeById } from "./registry";
import type { AnyParams, ParamsArg, StateArg } from "./route-contracts";
import type { RouteId } from "./route-ids";
import { buildRoutePath, type TransitionDef } from "./route-kit";

export type RouteLinkProps<Id extends RouteId> = Omit<
  LinkProps,
  "to" | "state"
> & {
  transition: TransitionDef<Id>;
} & ParamsArg<Id> &
  StateArg<Id>;

/** Declarative counterpart of useAppNavigate().go — for real links. */
export function RouteLink<Id extends RouteId>({
  transition,
  params,
  state,
  ...rest
}: RouteLinkProps<Id>) {
  return (
    <Link
      to={buildRoutePath(
        routeById(transition.to),
        params as AnyParams | undefined,
      )}
      state={state}
      {...rest}
    />
  );
}
