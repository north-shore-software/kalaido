/**
 * Build-time flags for features that exist in the tree but are not ready to be
 * used. A flag is the only sanctioned way to withhold a feature: hiding a nav
 * item with CSS leaves the route reachable by URL, which makes "not ready" mean
 * "unadvertised" rather than "unavailable".
 *
 * A flag turns off *both* halves — the way in and the destination (see
 * `RouteDef.featureFlag`). Deleting a flag should be a one-line change once the
 * feature ships.
 */
export type FeatureFlag = "connections";

const FEATURE_FLAGS: Record<FeatureFlag, boolean> = {
  /** Import/export/live-sync hub — in development, not reachable yet. */
  connections: false,
};

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
