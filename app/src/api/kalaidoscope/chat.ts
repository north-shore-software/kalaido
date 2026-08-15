import {
  DefaultChatTransport,
  type PrepareSendMessagesRequest,
  type UIMessage,
} from "ai";
import { kalaidoscopeAuthHeaders } from "@/api/kalaidoscope/client.ts";
import type { TypedPocketBase } from "@/api/kalaidoscope/types.ts";

export type ContextKind =
  | "Colour"
  | "Type"
  | "Fragment"
  | "Projection"
  | "Reflection";

export interface ContextItem {
  /** What sort of source this is — drives the icon and how it resolves later. */
  kind: ContextKind;
  /** Record id for Colour/Fragment/Projection/Reflection; the fragment-type enum value for Type. */
  id: string;
  label: string;
  /** A colour's `value` (tailwind class / hex / css colour) — Colour kind only. */
  value?: string;
  /**
   * This item is the subject of the work, not just material for it. Everything
   * unfocused becomes background — still sent, but framed as reference. Purely a
   * matter of how the context is presented; it never changes what's in it.
   */
  focus?: boolean;
}

export type MessageRole = "user" | "assistant";

// A persisted assistant thread. Backed by the `chat_conversation` collection,
// with messages stored separately in `chat_message`.
export interface Conversation {
  id: string; // PocketBase record id — used to query its messages
  clientId: string; // AI SDK chat id — used to resume via useChat `id`
  preview: string; // first user message text, for the list label
  createdAt: string;
}

/**
 * The absolute desired state of the chat context, mirroring the backend's
 * `api.ContextSpec`. It is sent to `/api/chat` as a `system` message carrying a
 * `context_spec` part (see {@link contextSpecMessage}); the backend resolves it
 * to concrete ids and diffs it against earlier specs to hydrate the prompt.
 *
 * An empty spec (`{}`) is meaningful: it clears all previously pinned context.
 */
export interface ContextSpec {
  /**
   * Individual fragments pinned by id, included whatever their type or colours.
   * Unlike the rules below this set is static — it never grows as new fragments
   * arrive — so it supplements them rather than replacing them.
   */
  fragmentIds?: string[];
  fragmentTypes?: string[];
  colourIds?: string[];
  sourceProjectionIds?: string[];
  sourceReflectionIds?: string[];
  wholeScope?: boolean;
  /**
   * The part of this context the work is about; whatever the outer spec covers
   * beyond it is background. One level only — a nested `focus` is ignored
   * server-side.
   */
  focus?: ContextSpec;
}

/**
 * Mirrors the backend's `api.WindowSpec`. For a scheduled reflection: `period`
 * is the regeneration cadence and `duration` the lookback length, both as Go
 * duration strings in hours (e.g. "168h"); `startTime` is an optional RFC3339
 * anchor (defaults server-side to the reflection's creation). A reflection is
 * "scheduled" iff `period` is non-empty.
 *
 * Carried to the backend the same way as a {@link ContextSpec}: appended to the
 * chat as a `system` message with a `window_spec` part (see ChatPanel), and
 * persisted onto the reflection when a refinement is committed.
 */
export interface WindowSpec {
  startTime?: string;
  period: string;
  duration: string;
}

/**
 * Collapse the context picker's selection into a {@link ContextSpec}. Each
 * `ContextItem.kind` maps to one spec field; the picker's ids are exactly what
 * the backend expects (the fragment-type enum value for `Type`, record ids for
 * the rest). An empty selection yields `{}` — i.e. "clear the context".
 */
export function itemsToSpec(items: ContextItem[]): ContextSpec {
  const spec = criteriaToSpec(items.filter((it) => !it.focus));

  const focused = items.filter((it) => it.focus);
  if (focused.length) spec.focus = criteriaToSpec(focused);

  // "Nothing selected" means the whole kalaidoscope. Note this is decided by the
  // *whole* selection, not by what's left after the focus is split out —
  // otherwise focusing your only item would silently drag everything else in as
  // background.
  if (items.length === 0) spec.wholeScope = true;
  return spec;
}

/** Fold items into the spec fields they select, with no whole-scope logic. */
function criteriaToSpec(items: ContextItem[]): ContextSpec {
  const fragmentIds: string[] = [];
  const fragmentTypes: string[] = [];
  const colourIds: string[] = [];
  const sourceProjectionIds: string[] = [];
  const sourceReflectionIds: string[] = [];

  for (const it of items) {
    switch (it.kind) {
      case "Type":
        fragmentTypes.push(it.id);
        break;
      case "Fragment":
        fragmentIds.push(it.id);
        break;
      case "Colour":
        colourIds.push(it.id);
        break;
      case "Projection":
        sourceProjectionIds.push(it.id);
        break;
      case "Reflection":
        sourceReflectionIds.push(it.id);
        break;
    }
  }

  const spec: ContextSpec = {};
  if (fragmentIds.length) spec.fragmentIds = fragmentIds;
  if (fragmentTypes.length) spec.fragmentTypes = fragmentTypes;
  if (colourIds.length) spec.colourIds = colourIds;
  if (sourceProjectionIds.length)
    spec.sourceProjectionIds = sourceProjectionIds;
  if (sourceReflectionIds.length)
    spec.sourceReflectionIds = sourceReflectionIds;

  return spec;
}

/**
 * A lens stores its {@link ContextSpec} as a JSON field; PocketBase may hand it
 * back as a decoded object or a JSON string depending on the field. Normalise to
 * a spec (or null when absent/unparseable).
 */
export function parseContextSpec(raw: unknown): ContextSpec | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as ContextSpec;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ContextSpec;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalise a {@link WindowSpec} JSON field (object or string, as PocketBase may
 * hand it back) into a spec, or null when absent/unparseable.
 */
export function parseWindowSpec(raw: unknown): WindowSpec | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if (typeof o.period === "string" || typeof o.duration === "string") {
      return {
        startTime: typeof o.startTime === "string" ? o.startTime : undefined,
        period: typeof o.period === "string" ? o.period : "",
        duration: typeof o.duration === "string" ? o.duration : "",
      };
    }
  }
  return null;
}

/**
 * A canonical key for a WindowSpec, used (like {@link specKey}) to tell whether
 * the active window has changed since the last one we sent.
 */
export function windowSpecKey(spec: WindowSpec | undefined): string {
  if (!spec) return "";
  return JSON.stringify({
    startTime: spec.startTime ?? "",
    period: spec.period ?? "",
    duration: spec.duration ?? "",
  });
}

/**
 * Inverse of {@link itemsToSpec}: expand a {@link ContextSpec} back into context
 * items. Used to re-seed a fixed (non-editable) context into the refine chat so
 * the entity's existing lens context is carried through and preserved when the
 * lens is re-distilled. Labels aren't rendered for the fixed refine context, so
 * the id doubles as the label. `wholeScope` maps to an empty selection (which
 * `itemsToSpec` turns back into `wholeScope`).
 */
export function specToItems(spec: ContextSpec): ContextItem[] {
  const items = criteriaToItems(spec);
  // The focused half comes back marked, so the picker can render it as the
  // subject and `itemsToSpec` can split it out again unchanged.
  if (spec.focus) {
    for (const it of criteriaToItems(spec.focus)) {
      items.push({ ...it, focus: true });
    }
  }
  return items;
}

function criteriaToItems(spec: ContextSpec): ContextItem[] {
  const items: ContextItem[] = [];
  for (const id of spec.colourIds ?? [])
    items.push({ kind: "Colour", id, label: id });
  for (const t of spec.fragmentTypes ?? [])
    items.push({ kind: "Type", id: t, label: t });
  for (const id of spec.fragmentIds ?? [])
    items.push({ kind: "Fragment", id, label: id });
  for (const id of spec.sourceProjectionIds ?? [])
    items.push({ kind: "Projection", id, label: id });
  for (const id of spec.sourceReflectionIds ?? [])
    items.push({ kind: "Reflection", id, label: id });
  return items;
}

/**
 * A canonical, order-independent string for a spec, used to tell whether the
 * active context has actually changed since the last one we sent (so we only
 * emit a `context_spec` message when it has).
 */
export function specKey(spec: ContextSpec): string {
  return JSON.stringify({
    fragmentIds: [...(spec.fragmentIds ?? [])].sort(),
    fragmentTypes: [...(spec.fragmentTypes ?? [])].sort(),
    colourIds: [...(spec.colourIds ?? [])].sort(),
    sourceProjectionIds: [...(spec.sourceProjectionIds ?? [])].sort(),
    sourceReflectionIds: [...(spec.sourceReflectionIds ?? [])].sort(),
    wholeScope: spec.wholeScope ?? false,
    // Refocusing can move an item between focus and background without changing
    // what's selected, and the backend has to be told — so the key has to move.
    focus: spec.focus ? specKey(spec.focus) : "",
  });
}

/**
 * Scans a message stream backwards to find the most recent ContextSpec
 * that the frontend sent, returning it so the UI can reconstruct the panel state.
 */
export function parseActiveContext(messages: UIMessage[]): ContextSpec | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system" && m.parts) {
      // `context_spec` is a custom part type not in the SDK's part union (see
      // its emission in chat-panel.tsx), so inspect parts as loosely-typed.
      const parts = m.parts as { type: string; data?: unknown }[];
      const p = parts.find((p) => p.type === "context_spec");
      if (p && typeof p.data === "object" && p.data !== null) {
        return p.data as ContextSpec;
      }
    }
  }
  return null;
}

export function createKalaidoChatTransport(options: {
  baseURL: string;
  prepareSendMessagesRequest?: PrepareSendMessagesRequest<UIMessage>;
}): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>({
    // api is overridden by the custom fetch below — it always targets the
    // ACTIVE kalaidoscope (local sidecar or <cloud gateway>/<cloudId>) and
    // attaches the cloud JWT, so chat works on cloud kalaidoscopes and is metered.
    api: "/api/chat",
    prepareSendMessagesRequest: options.prepareSendMessagesRequest,
    fetch: async (_url, init) => {
      const headers = {
        ...(init?.headers as Record<string, string> | undefined),
        ...(await kalaidoscopeAuthHeaders(options.baseURL)),
      };
      const res = await fetch(`${options.baseURL}/api/chat`, {
        ...init,
        headers,
      });
      // The AI SDK doesn't expose the status on its error; tag the 402 so
      // onError can recognise the quota-exhausted case.
      if (res.status === 402) throw new Error("quota_exhausted");
      return res;
    },
  });
}

function previewText(content: unknown): string {
  const msg = content as UIMessage | undefined;
  if (!msg?.parts) return "";
  return msg.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

export async function listConversations(
  client: TypedPocketBase,
): Promise<Conversation[]> {
  const records = await client.collection("chat_conversation").getFullList({
    sort: "-created",
    requestKey: null,
  });

  // Batch-fetch early messages for all conversations (chunked OR filter) instead
  // of one request per conversation. A conversation can lead with `context_spec`/
  // `pinned_ids` system messages, which carry no chat text to preview, so we take
  // the earliest message with text. Conversations whose first text message falls
  // outside the fetched page fall back to "New conversation".
  const previews = new Map<string, string>();
  const CHUNK = 30;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const filter = chunk
      .map((r, idx) =>
        client.filter(`chat_conversation_id = {:id${idx}}`, {
          [`id${idx}`]: r.id,
        }),
      )
      .join(" || ");
    try {
      const { items } = await client
        .collection("chat_message")
        .getList(1, 200, {
          filter,
          sort: "created",
          requestKey: null,
        });
      for (const m of items) {
        const convId = m.chat_conversation_id;
        if (previews.has(convId)) continue;
        const text = previewText(m.content);
        if (text) previews.set(convId, text);
      }
    } catch (e) {
      console.warn("chat preview fetch failed", e);
    }
  }

  return records.map(
    (r) =>
      ({
        id: r.id,
        clientId: r.external_conversation_id ?? "",
        preview: previews.get(r.id) ?? "New conversation",
        createdAt: r.created,
      }) as Conversation,
  );
}

export async function getConversationMessages(
  client: TypedPocketBase,
  conversationId: string,
): Promise<UIMessage[]> {
  const records = await client.collection("chat_message").getFullList({
    filter: client.filter("chat_conversation_id = {:id}", {
      id: conversationId,
    }),
    sort: "created",
    requestKey: null,
  });
  return records.map((r) => r.content as UIMessage);
}
