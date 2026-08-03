import type { FragmentResponse } from "@/api/kalaidoscope/types";

export type MatchType =
  | "manual_positive"
  | "manual_negative"
  | "llm_matched_backfill"
  | "llm_matched_tag_on_input";

// The generated `ColourFragmentResponse` is stale (missing `match_type`/expand),
// so membership rows are read through this narrowed shape.
export interface MemberRow {
  id: string;
  colour_id: string;
  fragment_id: string;
  match_type: MatchType;
  expand?: { fragment_id?: FragmentResponse };
}

export function shortTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function preview(content: string): string {
  const t = content.trim().replace(/\s+/g, " ");
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}
