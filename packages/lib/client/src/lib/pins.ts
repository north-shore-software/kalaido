export function isPinned(pinnedBy: unknown, userId?: string | null): boolean {
  if (!userId) return false;
  if (Array.isArray(pinnedBy)) return pinnedBy.includes(userId);
  if (typeof pinnedBy === "string") return pinnedBy === userId;
  return false;
}
