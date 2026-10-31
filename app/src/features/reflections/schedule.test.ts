import { describe, expect, it } from "vitest";
import {
  buildWindowSpec,
  CADENCE_DAYS,
  cadenceFromSpec,
  DEFAULT_CADENCE,
  dateInputToStartTime,
  describeRecurrence,
  toDateInputValue,
} from "./schedule";

describe("cadenceFromSpec", () => {
  it("defaults when unscheduled", () => {
    expect(cadenceFromSpec(null)).toEqual({ cadence: DEFAULT_CADENCE });
  });

  it("maps each offered cadence back and keeps the origin", () => {
    for (const [i, days] of CADENCE_DAYS.entries()) {
      const spec = buildWindowSpec({
        cadenceDays: days,
        lookbackDays: days,
        startTime: "2026-09-01T00:00:00.000Z",
      });
      expect(cadenceFromSpec(spec)).toEqual({
        cadence: i,
        startTime: "2026-09-01T00:00:00.000Z",
      });
    }
  });

  it("lands schedules outside the offering on the nearest cadence", () => {
    expect(cadenceFromSpec({ period: "1h", duration: "1h" }).cadence).toBe(0);
    expect(cadenceFromSpec({ period: "168h", duration: "5040h" }).cadence).toBe(
      1,
    );
    expect(cadenceFromSpec({ period: "2160h", duration: "2160h" }).cadence).toBe(
      2,
    );
  });
});

describe("date input round trip", () => {
  it("is a local midnight", () => {
    const start = dateInputToStartTime("2026-03-15");
    expect(start).toBeDefined();
    const d = new Date(start as string);
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    expect(toDateInputValue(d)).toBe("2026-03-15");
    expect(dateInputToStartTime("")).toBeUndefined();
  });
});

describe("describeRecurrence", () => {
  const start = dateInputToStartTime("2026-10-05"); // a Monday
  const now = new Date(2026, 9, 14, 9); // Wed 14 Oct, 09:00 local

  it("names the weekday and the next grid point", () => {
    const line = describeRecurrence(1, start, now);
    const monday = new Date(2026, 9, 5).toLocaleDateString(undefined, {
      weekday: "long",
    });
    const next = new Date(2026, 9, 19).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    expect(line).toContain(`every ${monday}`);
    expect(line).toContain("previous 7 days");
    expect(line).toContain(`next on ${next}`);
  });

  it("puts the first summary one period after a start of today", () => {
    const today = dateInputToStartTime("2026-10-14");
    const tomorrow = new Date(2026, 9, 15).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    expect(describeRecurrence(0, today, now)).toContain(`next on ${tomorrow}`);
  });

  it("omits the next date without an origin", () => {
    expect(describeRecurrence(2, undefined, now)).toBe(
      "New summary every 30 days, covering the previous 30 days.",
    );
  });
});
