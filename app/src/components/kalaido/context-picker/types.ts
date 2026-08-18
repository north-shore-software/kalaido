import type { ContextItem, ContextKind } from "@/api/kalaidoscope/chat.ts";

export type { ContextItem, ContextKind };

/**
 * Which sort of thing is being given a context. A Reflection is a leaf node in
 * the dependency graph, so it can read fragments but never other syntheses —
 * see {@link allowsSources}.
 */
export type EntityKind = "projection" | "reflection" | "chat";

/** Whether this entity may pin projections/reflections as sources. */
export function allowsSources(entity: EntityKind): boolean {
  return entity !== "reflection";
}
