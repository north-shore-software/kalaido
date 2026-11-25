/**
 * "system" follows the OS appearance; the other two pin it. The stored value is
 * the user's *choice*, not the resolved appearance — so someone on "system"
 * keeps following the OS after a restart instead of being frozen at whatever it
 * happened to be when they last quit.
 */
export type Theme = "dark" | "light" | "system";

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export const LIGHT_THEME_SHIPPED = true;

/** What "system" currently means. */
export function resolveTheme(theme: Theme): "dark" | "light" {
  if (!LIGHT_THEME_SHIPPED) return "dark";
  if (theme === "system") return prefersDark() ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark",
  );
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
