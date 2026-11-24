const MAX_DERIVED_WORDS = 6;

/**
 * A readable display name derived from an opening prompt, used only until the
 * user types one or the model suggests one: the whole prompt when it is six
 * words or fewer, its first six words plus an ellipsis otherwise, and the
 * caller's fallback (e.g. "Untitled projection") for blank input.
 */
export function deriveName(prompt: string, fallback: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  if (words.length <= MAX_DERIVED_WORDS) return words.join(" ");
  return `${words.slice(0, MAX_DERIVED_WORDS).join(" ")}…`;
}
