export type AppVariant = "desktop" | "mobile" | "web";
let current: AppVariant = "desktop";
export function setAppVariant(variant: AppVariant): void {
  current = variant;
}
export function appVariant(): AppVariant {
  return current;
}
