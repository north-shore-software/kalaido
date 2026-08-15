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
}

/**
 * A post-kalaidoscope-creation action seeded from a template, rendered as a card on the
 * home page. Only `import` exists today. Persisted per kalaidoscope.
 */
export interface KalaidoscopeAction {
  id: string;
  type: "import";
  title: string;
  description: string;
  icon?: string;
}
