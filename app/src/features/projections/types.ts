import type { ContextSpec } from "@/api/kalaidoscope/chat";

/**
 * A projection that starts from something that already exists — a fragment being
 * graduated, or a projection being forked — rather than from a typed prompt.
 * Passed as router state; see {@link ProjectionSeed} consumers for who sends it.
 */
export interface ProjectionSeed {
  /**
   * An existing proposed projection to take up, instead of creating a new
   * row. Set by the dashboard's Proposed group; committing the refinement
   * makes it active.
   */
  id?: string;
  name: string;
  /**
   * The material this projection starts from. Sent as the session's first user
   * message (framed by {@link seedPrompt}) so the model's first turn derives a
   * lens from it — the document only exists once a lens produces it, so there
   * is no zero-turn draft any more. Empty for flows that let the user type
   * their own first message.
   */
  draft: string;
  /**
   * A ready-made first user message, sent verbatim. A proposal's opening
   * message is already the user's own instruction, so it takes no framing.
   */
  message?: string;
  /** Inputs the new projection reads. Seeds both the picker and the chat. */
  contextSpec?: ContextSpec;
  /** Kept on the projection as what it is for — a chat's brief. */
  description?: string;
}
