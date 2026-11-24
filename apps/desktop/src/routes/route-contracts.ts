import type { ColourSeed } from "@/features/colours/types";
import type { KalaidoscopeSetupState } from "@/features/create-kalaidoscope/types";
import type { ProjectionSeed } from "@/features/projections/types";
import type { ReflectionSeed } from "@/features/reflections/types";
import type { RouteId } from "./route-ids";

/**
 * What each screen expects to receive: URL params and/or router state.
 *
 * Routes absent from this map take neither. `params` is the flat union of the
 * route's path patterns — a key is required iff the primary `path` requires
 * it; keys that only an alias carries are optional. `defineRoute` checks the
 * declared params against the actual patterns at compile time, so this map
 * and the URL shapes cannot drift.
 *
 * `state` is what `go(transition, { state })` may send and what the page reads
 * back with `useAppRouteState`. Every state shape is all-optional: a screen
 * is always reachable by a plain `go(...)` with no state at all.
 */
export type RouteContracts = {
  settings: { params: { section?: string } };
  stream: { params: { id?: string } };
  reflections: { params: { id?: string; windowId?: string } };
  "refine-reflection": {
    params: { id: string };
    state: { seed?: ReflectionSeed };
  };
  "projection-detail": { params: { id: string; snapshotId?: string } };
  "projection-review": {
    params: { id: string; snapshotId: string };
    state: { wave?: boolean };
  };
  "onboarding-organizing": { params: { ingestId: string } };
  "kalaidoscope-setup": { state: KalaidoscopeSetupState };
  "new-projection": { state: { seed?: ProjectionSeed } };
  colours: { state: { seed?: ColourSeed } };
  explore: { state: { initialPrompt?: string } };
};

type ContractOf<Id extends RouteId> = Id extends keyof RouteContracts
  ? RouteContracts[Id]
  : Record<never, never>;

/**
 * The params a route takes, or `undefined` when it takes none. Distributes
 * over a union of ids, so a component serving several routes sees each one's
 * shape (`undefined` included for the param-free ones).
 */
export type ParamsOf<Id extends RouteId> = Id extends unknown
  ? ContractOf<Id> extends { params: infer P }
    ? P
    : undefined
  : never;

/** The router state a route accepts, or `undefined` when it accepts none. */
export type StateOf<Id extends RouteId> = Id extends unknown
  ? ContractOf<Id> extends { state: infer S }
    ? S
    : undefined
  : never;

/**
 * The `params` slot of a navigation call: absent for param-free routes,
 * optional when every param is optional, required otherwise.
 */
export type ParamsArg<Id extends RouteId> = [ParamsOf<Id>] extends [undefined]
  ? { params?: undefined }
  : // biome-ignore lint/complexity/noBannedTypes: `{}` is the "no required keys" probe
    {} extends ParamsOf<Id>
    ? { params?: ParamsOf<Id> }
    : { params: ParamsOf<Id> };

/** The `state` slot of a navigation call: absent for routes that take none. */
export type StateArg<Id extends RouteId> = [StateOf<Id>] extends [undefined]
  ? { state?: undefined }
  : { state?: StateOf<Id> };

/** Runtime shape every params object erases to. */
export type AnyParams = Record<string, string | undefined>;
