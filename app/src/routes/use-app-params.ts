import { useParams } from "react-router-dom";
import type { ParamsOf } from "./route-contracts";
import type { RouteId } from "./route-ids";

/**
 * The URL params of the mounted screen, typed by its route id (see
 * `RouteContracts`). A component that serves several routes names them all —
 * `useAppParams<"new-reflection" | "refine-reflection">()` — and gets the
 * union, `undefined` included for the param-free one.
 */
export function useAppParams<Id extends RouteId>(): ParamsOf<Id> {
  return useParams() as ParamsOf<Id>;
}
