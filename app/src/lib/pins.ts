/** `pinned_by` is a multi-relation — truthy/non-empty means pinned. */
export function isPinned(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "string" && v.length > 0;
}
