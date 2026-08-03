import { Link, type LinkProps } from "react-router-dom";
import { routeById } from "./registry";
import { buildRoutePath, type TransitionDef } from "./route-kit";

export type RouteLinkProps = Omit<LinkProps, "to"> & {
  transition: TransitionDef;
  params?: Record<string, string | undefined>;
};

/** Declarative counterpart of useAppNavigate().go — for real links. */
export function RouteLink({ transition, params, ...rest }: RouteLinkProps) {
  return (
    <Link to={buildRoutePath(routeById(transition.to), params)} {...rest} />
  );
}
