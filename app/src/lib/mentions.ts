import type { ContextItem, ContextKind } from "@/api/kalaidoscope/chat";
import {
  isWholeScopeSelection,
  WHOLE_SCOPE_ITEM,
} from "@/api/kalaidoscope/context-items";

/** The kinds a message can @-mention — every context kind except the two markers. */
export type MentionKind = Exclude<ContextKind, "WholeScope" | "Summaries">;

/**
 * The wire form of a named-source mention: `@[Kind:id|Label]`. The @-menu
 * resolves a mention to a concrete record at compose time, so the id is
 * authoritative and the label is display-only. The raw token is what persists
 * in the message; the backend expands it to a model-facing reference at
 * prompt-assembly time (kalaidoscope/internal/llmcontext/mentions.go keeps the
 * mirrored regex — change them together).
 */
const MENTION_SOURCE =
  "@\\[(Fragment|Projection|Reflection|Colour|Type):([A-Za-z0-9_-]{1,32})\\|([^\\]\\r\\n]{0,80})\\]";

const MAX_LABEL = 60;

/**
 * Make a label safe to embed in a token without an escaping grammar: the
 * structural characters are substituted with lookalikes and newlines collapse
 * to spaces. Lossy on purpose — the label is cosmetic.
 */
export function sanitizeMentionLabel(label: string): string {
  return label
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL);
}

export function buildMentionToken(
  kind: MentionKind,
  id: string,
  label: string,
): string {
  return `@[${kind}:${id}|${sanitizeMentionLabel(label)}]`;
}

export interface MentionSegment {
  type: "text" | "mention";
  /** The raw slice of the message — for a mention, the whole token. */
  text: string;
  kind?: MentionKind;
  id?: string;
  label?: string;
}

/** Tokenize a message into literal runs and mention tokens, for rendering. */
export function splitMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  const re = new RegExp(MENTION_SOURCE, "g");
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) {
      segments.push({ type: "text", text: text.slice(last, m.index) });
    }
    const [token, kind, id, label] = m;
    segments.push({
      type: "mention",
      text: token,
      kind: kind as MentionKind,
      id,
      label: label || id,
    });
    last = m.index + token.length;
  }
  if (last < text.length) {
    segments.push({ type: "text", text: text.slice(last) });
  }
  return segments;
}

/**
 * Replace each mention token with a `<kmention>` tag for the markdown
 * renderer, so chips survive markdown parsing (the tag is allowlisted and its
 * children treated as a literal label, never prose). Fence-aware: a token
 * quoted inside a ``` block stays literal, like any other code.
 */
export function mentionsToTags(text: string): string {
  const re = new RegExp(MENTION_SOURCE, "g");
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(
        re,
        (_, __, id: string, label: string) =>
          `<kmention>@${escapeHtml(label || id)}</kmention>`,
      );
    })
    .join("\n");
}

/** Replace each mention token with a plain `@Label` — for previews and other cosmetic surfaces. */
export function stripMentions(text: string): string {
  return text.replace(
    new RegExp(MENTION_SOURCE, "g"),
    (_, __, id: string, label: string) => `@${label || id}`,
  );
}

export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  /** What the user has typed after the `@` so far. */
  query: string;
}

/**
 * The mention being typed at the caret, if any: a `@` at the start of the text
 * or after whitespace, with no whitespace or `]` between it and the caret (so a
 * completed token, an email address, or a mid-word `@` never triggers the menu).
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): MentionQuery | null {
  const upto = text.slice(0, caret);
  const start = upto.lastIndexOf("@");
  if (start === -1) return null;
  if (start > 0 && !/\s/.test(upto[start - 1])) return null;
  const query = upto.slice(start + 1);
  if (/[\s\]]/.test(query)) return null;
  return { start, query };
}

/**
 * Fold a tagged/picked item into a context selection under the bar's union
 * model. Colours and types are checkbox entries: on a whole-scope selection
 * they are already checked, so the tag is a no-op; on an enumerated one it
 * checks them. Fragments/projections/reflections are pins that add to the
 * union — pinning onto the empty (all-checked) selection materialises the
 * whole-scope marker first so the scope survives instead of narrowing to the
 * pin. Kind+id duplicates are always ignored.
 */
export function withContextItem(
  items: ContextItem[],
  item: ContextItem,
): ContextItem[] {
  if (items.some((it) => it.kind === item.kind && it.id === item.id))
    return items;
  if (item.kind === "Colour" || item.kind === "Type") {
    return isWholeScopeSelection(items) ? items : [...items, item];
  }
  if (
    item.kind !== "WholeScope" &&
    item.kind !== "Summaries" &&
    items.length === 0
  ) {
    return [WHOLE_SCOPE_ITEM, item];
  }
  return [...items, item];
}
