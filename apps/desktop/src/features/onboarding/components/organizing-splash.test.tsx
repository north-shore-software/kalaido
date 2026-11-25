import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizingSplash } from "./organizing-splash";

function createCanvasStub(): CanvasRenderingContext2D {
  const noop = () => {};
  return {
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
  } as unknown as CanvasRenderingContext2D;
}

class Path2DStub {
  rect() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
}

describe("OrganizingSplash", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let rafQueue: Array<(time: number) => void> = [];
  let nextRafId = 1;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubGlobal("Path2D", Path2DStub);
    rafQueue = [];
    nextRafId = 1;
    HTMLCanvasElement.prototype.getContext = vi.fn(() =>
      createCanvasStub(),
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafQueue.push(cb);
      return nextRafId++;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function flushRaf() {
    const callbacks = rafQueue;
    rafQueue = [];
    for (const cb of callbacks) {
      cb(performance.now());
    }
  }

  it("rotates phrases on timer and progresses cleanly through end phases", () => {
    const onSnapshotReady = vi.fn();
    const onEnded = vi.fn();

    const { rerender } = render(
      <OrganizingSplash
        progress={0.25}
        ending={false}
        onSnapshotReady={onSnapshotReady}
        onEnded={onEnded}
      />,
    );

    expect(screen.queryByText("converging fragments…")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(9000);
      flushRaf();
    });
    expect(
      screen.getByText("converging fragments…").parentElement?.style.opacity,
    ).toBe("0");

    act(() => {
      vi.advanceTimersByTime(650);
      flushRaf();
    });
    expect(screen.queryByText("rotating the lens…")).not.toBeNull();
    expect(
      screen.getByText("rotating the lens…").parentElement?.style.opacity,
    ).toBe("1");

    // Entering ending immediately overrides status without waiting for a rAF tick.
    rerender(
      <OrganizingSplash
        progress={1}
        ending
        onSnapshotReady={onSnapshotReady}
        onEnded={onEnded}
      />,
    );
    expect(screen.queryByText("finalizing snapshot…")).not.toBeNull();
    expect(
      screen.getByText("finalizing snapshot…").parentElement?.style.opacity,
    ).toBe("1");

    // Advance past 3.0s -> "snapshot ready" + onSnapshotReady
    act(() => {
      vi.advanceTimersByTime(3100);
      flushRaf();
    });
    expect(screen.queryByText("snapshot ready")).not.toBeNull();
    expect(
      screen.getByText("snapshot ready").parentElement?.style.opacity,
    ).toBe("1");
    expect(onSnapshotReady).toHaveBeenCalledTimes(1);
    expect(onEnded).not.toHaveBeenCalled();

    // Advance past 5.2s -> fade out + onEnded
    act(() => {
      vi.advanceTimersByTime(2200);
      flushRaf();
    });
    expect(
      screen.getByText("snapshot ready").parentElement?.style.opacity,
    ).toBe("0");
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
