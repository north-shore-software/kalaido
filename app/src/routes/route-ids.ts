/** Every routable screen in the app. Adding a page = adding an id here first. */
export const ROUTE_IDS = [
  "splash",
  "boot-error",
  "kalaidoscope-setup",
  "settings",
  "main",
  "stream",
  "import",
  "projections",
  "projection-detail",
  "projection-review",
  "new-projection",
  "reflections",
  "new-reflection",
  "colours",
  "connections",
  "rotation",
  "chat",
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];
