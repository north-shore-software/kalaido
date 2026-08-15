/**
 * "system" follows the OS appearance; the other two pin it. The stored value is
 * the user's *choice*, not the resolved appearance — so someone on "system"
 * keeps following the OS after a restart instead of being frozen at whatever it
 * happened to be when they last quit.
 */
export type Theme = "dark" | "light" | "system";

const THEME_STORAGE_KEY = "theme";

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** What "system" currently means. */
export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") return prefersDark() ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark",
  );
}

export function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") {
      return stored;
    }
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return "system";
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the theme still applies, it just won't survive a restart.
  }
}

/**
 * Calls back when the OS appearance changes. Only meaningful while the user's
 * choice is "system"; the caller is responsible for that check.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
