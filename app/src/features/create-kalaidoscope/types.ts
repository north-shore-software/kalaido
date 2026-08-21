import type { StorageType } from "./components/storage-option-cards";

/**
 * Router state accepted by the kalaidoscope-setup route. Every field is
 * optional: the page is reachable by a plain `go(...)` with no state at all,
 * and falls back to the signed-in default in that case.
 */
export interface KalaidoscopeSetupState {
  /** Forces the initial storage choice, overriding the signed-in default. */
  defaultStorage?: StorageType;
  /** Arrived straight from sign-up — greet them rather than showing a bare form. */
  firstWorkspace?: boolean;
  /** Land on the onboarding import page once the workspace exists. */
  intent?: "import";
}
