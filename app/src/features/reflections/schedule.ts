import { parseWindowSpec, type WindowSpec } from "@/api/kalaidoscope/chat";

// Reflection schedule UI options for the refine screen (creating and the
// existing case alike). Frequency = how often it regenerates;
// lookback = the data window each run summarizes. A reflection's schedule lives
// on `window_spec_versions`, an append-only list: it is set at creation and
// updated by PATCHing the reflection (see `usePersistSchedule`).
export const FREQ = ["Hourly", "Daily", "Weekly", "Monthly"] as const;
export const FREQ_DAYS = [1 / 24, 1, 7, 30];
export const WIN = ["1h", "24h", "7 days", "30 days", "7 months"] as const;
export const WIN_DAYS = [1 / 24, 1, 7, 30, 210];

// Default chip selection when a reflection has no window spec yet.
export const DEFAULT_FREQ = 2; // Weekly
export const DEFAULT_WIN = 2; // 7 days

// Go's time.ParseDuration has no "d" unit, so windows are expressed in hours.
const hoursStr = (days: number) => `${Math.round(days * 24)}h`;

export function buildWindowSpec(input: {
  cadenceDays: number;
  lookbackDays: number;
  /** Grid origin (RFC3339); in the past at creation = summarize from then. */
  startTime?: string;
}): WindowSpec {
  return {
    ...(input.startTime ? { startTime: input.startTime } : {}),
    period: hoursStr(input.cadenceDays),
    duration: hoursStr(input.lookbackDays),
  };
}

/** A canonical key for a schedule, to notice when the chips actually changed. */
export function scheduleKey(spec: WindowSpec): string {
  return `${spec.startTime ?? ""}|${spec.period}|${spec.duration}`;
}

/**
 * How many grid windows lie between `startTime` and now — the number of
 * historical summaries "summarize from <date>" will generate. Same maths as
 * the server's grid (grid point k at start + k·period, k ≥ 1, ≤ now).
 */
export function countGridWindows(
  startTime: string | undefined,
  cadenceDays: number,
  now: Date = new Date(),
): number {
  if (!startTime) return 0;
  const start = new Date(startTime).getTime();
  const periodMs = Math.round(cadenceDays * 24) * 60 * 60 * 1000;
  if (!Number.isFinite(start) || periodMs <= 0) return 0;
  return Math.max(0, Math.floor((now.getTime() - start) / periodMs));
}

function durationHours(s: string | undefined): number {
  if (!s) return 0;
  const m = /^(\d+(?:\.\d+)?)h$/.exec(s.trim());
  return m ? parseFloat(m[1]) : 0;
}

function nearestIndex(days: number, table: number[]): number {
  let best = 0;
  let bestDiff = Infinity;
  table.forEach((d, i) => {
    const diff = Math.abs(d - days);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

export function currentWindowSpec(raw: unknown): unknown {
  let versions: unknown = raw;
  if (typeof raw === "string") {
    try {
      versions = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const latest = versions.reduce((a, b) =>
    (b?.versionNumber ?? 0) > (a?.versionNumber ?? 0) ? b : a,
  );
  return latest?.spec ?? null;
}

/**
 * Reverse-map a reflection's `window_spec_versions` (raw JSON field) to the
 * nearest freq/lookback chip indices, so the detail view can seed its editable
 * controls. Falls back to defaults when the reflection isn't scheduled yet.
 */
export function windowSpecToChips(raw: unknown): { freq: number; win: number } {
  const spec = parseWindowSpec(raw);
  if (!spec?.period) return { freq: DEFAULT_FREQ, win: DEFAULT_WIN };
  return {
    freq: nearestIndex(durationHours(spec.period) / 24, FREQ_DAYS),
    win: nearestIndex(durationHours(spec.duration) / 24, WIN_DAYS),
  };
}

export function describeWindow(raw: unknown): {
  freq: string;
  win: string;
  scheduled: boolean;
} {
  const spec = parseWindowSpec(raw);
  const scheduled = !!spec?.period;
  const hours = durationHours(spec?.duration);
  let win = "all time";
  if (hours > 0) win = hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
  return { freq: scheduled ? "scheduled" : "manual", win, scheduled };
}
