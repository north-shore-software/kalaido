// Shared date/time formatting. Pages render PocketBase ISO strings, so every
// helper accepts a string (or Date) and parses defensively via `new Date()`.

/** Time of day, 24-hour, e.g. "14:05". */
export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Day bucket for grouping a timeline: "Today", "Yesterday", or an absolute
 * label like "Monday, Jun 2" for anything older.
 */
export function formatDayGroup(date: string | Date): string {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Compact absolute date + time, e.g. "Jun 2, 2:05 PM". */
export function formatShortDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

// Duration conversion. Schedules store durations in seconds; the UI works in
// whole days.

export const DAY = 86400;

/** Whole days → seconds, clamped to at least one day. */
export function daysToSecs(days: number): number {
  return Math.max(1, Math.round(days)) * DAY;
}

/**
 * A window's bounds as dates — "3 Aug – 10 Aug", with the year only when it
 * isn't the current one. The end is exclusive on the server (half-open
 * windows); a midnight-aligned end therefore names the first day *not*
 * covered, so it is shown as the preceding day.
 */
export function formatWindowRange(
  start: string | Date,
  end: string | Date,
): string {
  const s = new Date(start);
  let e = new Date(end);
  if (
    e.getUTCHours() === 0 &&
    e.getUTCMinutes() === 0 &&
    e.getTime() - s.getTime() > 24 * 60 * 60 * 1000
  ) {
    e = new Date(e.getTime() - 60 * 1000);
  }
  const thisYear = new Date().getFullYear();
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      ...(d.getFullYear() !== thisYear ? { year: "numeric" } : {}),
    }).format(d);
  return `${fmt(s)} – ${fmt(e)}`;
}
