import type { ContextItem } from "@/api/kalaidoscope/chat";

/**
 * The context a refocused chat starts from: the saved fragment as its subject,
 * with whatever the previous chat was working from carried across as background.
 *
 * Nothing is dropped — narrowing the conversation shouldn't cost you the sources
 * that got you here — but everything is demoted, including a previous focus.
 * Only one thing is the subject at a time; that is what makes this a *re*focus
 * rather than an accumulation.
 */
export function refocusedContext(
  previous: ContextItem[],
  fragmentId: string,
): ContextItem[] {
  return [
    { kind: "Fragment", id: fragmentId, label: fragmentId, focus: true },
    // De-duplicated, so refocusing twice onto the same fragment can't leave it
    // sitting in its own background.
    ...previous
      .filter((it) => !(it.kind === "Fragment" && it.id === fragmentId))
      .map((it) => ({ ...it, focus: false })),
  ];
}
