import { useLocation } from "react-router-dom";

/**
 * The current location's pathname, for chrome that highlights the active
 * destination. Compare against `pathFor(...)`, never a hand-written literal.
 */
export function useCurrentPathname(): string {
  return useLocation().pathname;
}
