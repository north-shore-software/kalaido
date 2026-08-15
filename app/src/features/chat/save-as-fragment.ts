import type { Result } from "neverthrow";

import { addFragment } from "@/api/kalaidoscope/fragments";

/**
 * Provenance recorded on a fragment captured from a chat. The chat's client id
 * is what `chat_conversation.external_conversation_id` holds, so this points
 * back at the thread — and unlike the conversation's record id it exists from
 * the first message, before any conversation row has been written.
 */
export function chatFragmentSource(clientId: string): string {
  return `chat:${clientId}`;
}

/**
 * Keep a chat answer as ground truth.
 *
 * The result is an ordinary fragment: it joins whole-scope context, gets
 * classified against every colour like anything else, and can be pinned into a
 * context spec by id. Its `chat` type is only what makes this origin visible —
 * and selectable — later.
 */
export async function saveChatResponseAsFragment(
  content: string,
  opts: { clientId: string },
): Promise<Result<string, Error>> {
  return addFragment("chat", content.trim(), {
    source: chatFragmentSource(opts.clientId),
  });
}
