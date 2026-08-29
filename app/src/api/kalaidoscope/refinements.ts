import type { UIMessage } from "ai";
import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";
import type { ContextSpec } from "./chat";

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
 * matches `refine_*_conversation.external_conversation_id`). Each drafting turn
 * the assistant emits a revised lens through the `update_lens` tool call, the
 * server executes it, and the executed output streams back as a fabricated
 * `apply_result` tool part — that output is what the preview shows.
 *
 * `snapshotId` scopes the session to an existing snapshot: the backend seeds the
 * new conversation with that snapshot's `context_spec` (and `window_spec` for
 * reflections), so the refine model gets it automatically — callers do not pass
 * context here. Omit `snapshotId` when authoring a brand-new view: there is no
 * parent snapshot or lens yet; both are born when this refinement is committed.
 * Every session needs at least one chat turn before it can commit — the lens
 * only exists once the model drafts one.
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
        },
      },
    ),
  );
}

/**
 * Commit a refinement session: the server extracts the latest drafted lens and
 * the output that lens produced, installs the lens as the parent's current one,
 * and materializes the output as a new approved snapshot (superseded pending
 * candidates are discarded server-side). Fails with 400 when no lens was ever
 * drafted (a seeded session with zero turns) and 409 when the latest lens has
 * no generated preview (its apply failed).
 */
export async function commitRefinement(input: {
  target: "projection" | "reflection";
  parentId: string;
  refinementId: string;
}): Promise<Result<CommitRefinementResult, Error>> {
  return withActiveClient((client) =>
    client.send<CommitRefinementResult>(
      `/api/${input.target}s/${input.parentId}/refinements/${input.refinementId}/commit`,
      { method: "POST", body: {} },
    ),
  );
}

export const UPDATE_LENS_TOOL = "update_lens";
export const APPLY_RESULT_TOOL = "apply_result";
const SUGGEST_NAME_TOOL = "suggest_name";

/**
 * Read a named tool call's input out of a single message part, tolerating both
 * shapes a refinement turn can take:
 *
 * - Live stream: the AI SDK materializes tool calls (real ones, and the
 *   server-fabricated `apply_result`) as `dynamic-tool` parts
 *   (`{ type: "dynamic-tool", toolName, state, input }`).
 *   See https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#dynamic-tools.
 * - Persisted: the backend stores them as `{ type: "tool-<name>",
 *   data: { toolCallId, toolName, input } }` (see
 *   internal/handlers/refinement_chat.go). Resumed sessions are normalized to
 *   the live shape by {@link normalizeRefinementMessages}, but we accept the
 *   persisted shape here too so the extractors are robust even if some path
 *   forgets to normalize.
 *
 * `terminalOnly` skips parts still streaming (`input-streaming`) — the shape
 * the readiness gate wants, where only a completed input counts.
 */
function toolInputFromPart(
  part: unknown,
  toolName: string,
  terminalOnly = false,
): Record<string, unknown> | null {
  const p = part as {
    type?: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    data?: { toolName?: string; input?: unknown };
  };
  if (p.type === "dynamic-tool" && p.toolName === toolName) {
    const okStates = terminalOnly
      ? ["input-available"]
      : ["input-streaming", "input-available"];
    if (!okStates.includes(p.state ?? "")) {
      return null;
    }
    return (p.input as Record<string, unknown> | undefined) ?? null;
  }
  if (p.type === `tool-${toolName}` && p.data) {
    return (p.data.input as Record<string, unknown> | undefined) ?? null;
  }
  return null;
}

/**
 * The model's name suggestion carried by one part, or null. Two carriers, per
 * the refinement prompt's naming protocol: before the first lens the model
 * calls `suggest_name` (`input.name`); with every lens the name rides
 * `update_lens`'s optional `suggested_name` argument.
 */
function suggestedNameFromPart(part: unknown): string | null {
  const lensInput = toolInputFromPart(part, UPDATE_LENS_TOOL);
  if (lensInput) {
    const name = lensInput.suggested_name;
    return typeof name === "string" ? name : null;
  }
  const suggestInput = toolInputFromPart(part, SUGGEST_NAME_TOOL);
  if (suggestInput) {
    const name = suggestInput.name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

/**
 * Pull the most recent non-empty name suggestion out of a refinement chat,
 * from either carrier. A draft turn that omits `suggested_name` does not erase
 * an earlier suggestion — the scan simply keeps looking further back. Empty
 * string until any suggestion lands.
 */
export function extractSuggestedNameFromMessages(
  messages: UIMessage[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.parts) continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const name = suggestedNameFromPart(m.parts[j])?.trim();
      if (name) return name;
    }
  }
  return "";
}

/** One apply_result part's output, or null. Streaming partials included unless `terminalOnly`. */
function applyOutputFromPart(part: unknown, terminalOnly = false): string | null {
  const input = toolInputFromPart(part, APPLY_RESULT_TOOL, terminalOnly);
  if (!input) return null;
  const output = input.output;
  return typeof output === "string" ? output : null;
}

/**
 * The preview text: scan assistant messages newest-first and return the latest
 * `apply_result` output — the drafted lens executed against the sources —
 * including a mid-stream partial, so the preview renders while the apply is
 * still generating. Empty string until any apply lands. Trimmed to match the
 * backend's commit-time extraction (`strings.TrimSpace`).
 */
export function extractPreviewFromMessages(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.parts) continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const output = applyOutputFromPart(m.parts[j]);
      if (output !== null) return output.trim();
    }
  }
  return "";
}

/**
 * Whether the session is committable: a *terminal* apply output exists. An
 * apply part is only ever written beside the lens that produced it, so this
 * implies a lens exists too — it is the approve/commit gate, matching the
 * server's own commit checks (400 with no lens, 409 with no preview).
 */
export function extractPreviewReady(messages: UIMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.parts) continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const output = applyOutputFromPart(m.parts[j], true);
      if (output !== null && output.trim() !== "") return true;
    }
  }
  return false;
}

/**
 * Where the current turn stands, derived purely from the newest assistant
 * message's parts — no extra stream-status plumbing:
 *
 * - "drafting": the lens tool call exists (streaming or done) with no apply
 *   output yet — the model is writing the instruction, or the server is about
 *   to execute it.
 * - "applying": the fabricated `apply_result` part is streaming — the executed
 *   preview is being generated.
 * - "ready": that turn's apply output is terminal.
 * - "idle": no drafting activity on the newest assistant turn (a clarify
 *   question, a failed apply's aftermath, or no assistant turn at all).
 *
 * Only the newest assistant message counts: the phase describes the turn in
 * flight, while {@link extractPreviewFromMessages} / {@link extractPreviewReady}
 * scan the whole transcript for the standing preview.
 */
export type RefinePhase = "idle" | "drafting" | "applying" | "ready";

export function extractRefinePhase(messages: UIMessage[]): RefinePhase {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.parts) continue;
    let sawLens = false;
    let sawError = false;
    let applyStreaming = false;
    let applyReady = false;
    for (const part of m.parts) {
      if (toolInputFromPart(part, UPDATE_LENS_TOOL)) sawLens = true;
      const output = applyOutputFromPart(part);
      if (output !== null) {
        if (applyOutputFromPart(part, true) !== null) applyReady = true;
        else applyStreaming = true;
      }
      if ((part as { type?: string }).type === "data-refine_error") {
        sawError = true;
      }
    }
    if (applyReady) return "ready";
    if (applyStreaming) return "applying";
    if (sawError) return "idle";
    if (sawLens) return "drafting";
    return "idle";
  }
  return "idle";
}

/**
 * Normalize persisted refinement history into the shape the live AI SDK stream
 * produces. The backend persists an assistant tool turn as
 * `{ type: "tool-<name>", data: { toolCallId, toolName, input } }`, but when a
 * session is resumed those parts must look like the AI SDK's `dynamic-tool`
 * parts — otherwise `useChat` mis-reads them (the `tool-<name>` type collides
 * with the SDK's static-tool naming) and {@link extractPreviewFromMessages} /
 * the live preview never see the lens or its output. Map each persisted
 * `tool-*` part to a terminal `dynamic-tool` part; `data-*` notice parts pass
 * through untouched (their persisted and live shapes already match).
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
