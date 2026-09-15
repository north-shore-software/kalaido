import { waveEnded } from "./use-start-ritual";

const pressedAt = Date.parse("2026-09-15T10:00:00.400Z");

describe("waveEnded", () => {
  test("not ended while a wave is running", () => {
    expect(
      waveEnded(pressedAt, {
        running: true,
        lastStarted: "2026-09-15T10:00:01Z",
      }),
    ).toBe(false);
  });

  test("not ended when the only wave predates the press", () => {
    expect(
      waveEnded(pressedAt, {
        running: false,
        lastStarted: "2026-09-15T09:59:59Z",
        lastCompleted: "2026-09-15T09:59:59Z",
      }),
    ).toBe(false);
  });

  test("ended once a wave started at or after the press is no longer running", () => {
    expect(
      waveEnded(pressedAt, {
        running: false,
        lastStarted: "2026-09-15T10:00:00Z",
      }),
    ).toBe(true);
    expect(
      waveEnded(pressedAt, {
        running: false,
        lastStarted: "2026-09-15T10:00:03Z",
        lastError: "provider: 503",
      }),
    ).toBe(true);
  });

  test("not ended before any status has been read", () => {
    expect(waveEnded(pressedAt, undefined)).toBe(false);
    expect(waveEnded(pressedAt, { running: false })).toBe(false);
  });
});
