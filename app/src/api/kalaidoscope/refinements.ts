import type { Result } from "neverthrow";
import type { UIMessage } from "ai";
import type { ContextSpec } from "./chat";
import { withActiveClient } from "./_active";

export interface CreateRefinementResult {
  refinementId: string;
  /**
   * Messages the server seeded onto the new conversation, with the ids it
   * persisted them under. Display these as-is — reconstructing an equivalent
   * message client-side would give it an id the server has never seen, and the
   * next turn would persist a duplicate.
   */
  messages?: UIMessage[];
}

export interface CommitRefinementResult {
  snapshotId: string;
}

/**
 * Open a refinement session nested under its parent
 * (`/api/projections/{id}/refinements` or `/api/reflections/{id}/refinements`).
 * The returned chat is driven through `/api/chat` using `clientId` as the chat
 * id — the backend auto-routes that conversation to the refinement handler (it
 * matches `refine_*_conversation.external_conversation_id`), so the assistant
 * replies by emitting a full revised draft inside a ```snapshot fenced block.
 *
 * `snapshotId` scopes the session to an existing snapshot: the backend seeds the
 * new conversation with that snapshot's `context_spec` (and `window_spec` for
 * reflections), so the refine model gets it automatically — callers do not pass
 * context here. Omit `snapshotId` when authoring a brand-new view: there is no
 * parent snapshot or lens yet; both are born when this refinement is committed.
 */
export async function createRefinement(input: {
  target: "projection" | "reflection";
  parentId: string;
  clientId: string;
  snapshotId?: string;
  /**
   * Open the session against this context instead of a snapshot's. Takes
   * precedence over `snapshotId`'s own spec — it's how a session starts from a
   * context nothing has been generated against yet (a fork's new inputs).
   */
  contextSpec?: ContextSpec;
  /**
   * Open the session with this text already drafted, recorded as though the
   * assistant had produced it. Committing distills it into a lens like any other
   * draft, so existing text can become a projection with no model call.
   */
  seedDraft?: string;
}): Promise<Result<CreateRefinementResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateRefinementResult>(
      `/api/${input.target}s/${input.parentId}/refinements`,
      {
        method: "POST",
        body: {
          clientId: input.clientId,
          ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
          ...(input.contextSpec ? { contextSpec: input.contextSpec } : {}),
          ...(input.seedDraft ? { seedDraft: input.seedDraft } : {}),
        },
      },
    ),
  );
}

/**
 * Commit a refinement session: the server extracts the latest drafted snapshot
 * block from the chat and materializes it as a new approved snapshot, promoted
 * to live (the superseded pending candidate is discarded server-side). The lens
 * is always re-distilled from the refined output, and the parent's
 * context/window spec re-saved (`updateLensAndContext: true`).
 */
export async function commitRefinement(input: {
  target: "projection" | "reflection";
  parentId: string;
  refinementId: string;
}): Promise<Result<CommitRefinementResult, Error>> {
  return withActiveClient((client) =>
    client.send<CommitRefinementResult>(
      `/api/${input.target}s/${input.parentId}/refinements/${input.refinementId}/commit`,
      { method: "POST", body: { updateLensAndContext: true } },
    ),
  );
}

const UPDATE_DRAFT_TOOL = "update_draft";

/**
 * Read the draft string out of a single message part, tolerating both shapes a
 * refinement turn can take:
 *
 * - Live stream: the AI SDK materializes the `update_draft` tool call as a
 *   `dynamic-tool` part (`{ type: "dynamic-tool", toolName, state, input }`).
 *   See https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#dynamic-tools
 *   and https://ai-sdk.dev/docs/reference/ai-sdk-core/dynamic-tool.
 * - Persisted: the backend stores it as `{ type: "tool-update_draft",
 *   data: { toolCallId, toolName, input } }` (see
 *   internal/handlers/refinement_chat.go). Resumed sessions are normalized to
 *   the live shape by {@link normalizeRefinementMessages}, but we accept the
 *   persisted shape here too so the preview is robust even if some seed path
 *   forgets to normalize.
 *
 * Returns the draft string, or null if this part isn't an update_draft call.
 */
function draftFromPart(part: unknown): string | null {
  const p = part as {
    type?: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    data?: { toolName?: string; input?: unknown };
  };
  if (p.type === "dynamic-tool" && p.toolName === UPDATE_DRAFT_TOOL) {
    if (p.state !== "input-streaming" && p.state !== "input-available") {
      return null;
    }
    const draft = (p.input as Record<string, unknown> | undefined)?.draft;
    return typeof draft === "string" ? draft : null;
  }
  if (p.type === `tool-${UPDATE_DRAFT_TOOL}` && p.data) {
    const draft = (p.data.input as Record<string, unknown> | undefined)?.draft;
    return typeof draft === "string" ? draft : null;
  }
  return null;
}

/**
 * Pull the most recent drafted snapshot text out of a refinement chat: scan
 * assistant messages newest-first and return the latest `update_draft` call's
 * draft input (empty string until one lands). Trimmed to match the backend's
 * commit-time extraction (`strings.TrimSpace`).
 */
export function extractDraftFromMessages(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.parts) continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const draft = draftFromPart(m.parts[j]);
      if (draft !== null) return draft.trim();
    }
  }
  return "";
}

/**
 * Normalize persisted refinement history into the shape the live AI SDK stream
 * produces. The backend persists an assistant tool turn as
 * `{ type: "tool-<name>", data: { toolCallId, toolName, input } }`, but when a
 * draft is resumed those parts must look like the AI SDK's `dynamic-tool` parts
 * — otherwise `useChat` mis-reads them (the `tool-<name>` type collides with the
 * SDK's static-tool naming) and {@link extractDraftFromMessages} / the live
 * preview never see the draft. Map each persisted `tool-*` part to a terminal
 * `dynamic-tool` part; leave every other part untouched.
 */
export function normalizeRefinementMessages(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map((m) => {
    if (!m.parts) return m;
    let changed = false;
    const parts = m.parts.map((part) => {
      const p = part as {
        type?: string;
        data?: { toolCallId?: string; toolName?: string; input?: unknown };
      };
      if (
        typeof p.type === "string" &&
        p.type.startsWith("tool-") &&
        p.data?.toolName
      ) {
        changed = true;
        return {
          type: "dynamic-tool",
          toolCallId: p.data.toolCallId ?? p.data.toolName,
          toolName: p.data.toolName,
          state: "input-available",
          input: p.data.input,
        } as unknown as (typeof m.parts)[number];
      }
      return part;
    });
    return changed ? ({ ...m, parts } as UIMessage) : m;
  });
}
