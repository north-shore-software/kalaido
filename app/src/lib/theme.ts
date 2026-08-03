export type Theme = "dark" | "light";

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function getInitialTheme(): Theme {
  return "light";
}

export function persistTheme(_theme: Theme): void {}
