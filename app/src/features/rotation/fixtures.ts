import type { Window } from "./components/active-rotation-card";

export const mockWindows: Window[] = [
  { start: "2026-06-03T00:00:00Z", end: "2026-06-10T00:00:00Z" },
  { start: "2026-06-10T00:00:00Z", end: "2026-06-17T00:00:00Z" },
];

export const mockActiveRotationProjection = {
  name: "Weekly Summary Projection",
  isReflection: false,
  entropy: 4,
  draft:
    "We've analyzed 4 new fragments from the stream. Overall, key highlights include setting up unified styling guidelines and migrating to pure component architectures.",
  busy: false,
  hasCandidate: true,
};

export const mockActiveRotationProjectionGenerating = {
  name: "Weekly Summary Projection",
  isReflection: false,
  entropy: 4,
  busy: true,
  hasCandidate: false,
};

export const mockActiveRotationReflection = {
  name: "Monthly Core reflection",
  isReflection: true,
  windows: mockWindows,
  busy: false,
  hasCandidate: false,
};

export const mockQueuedRows = [
  {
    name: "First Dependency Projection",
    dep: "waiting on upstream-1, upstream-2",
    n: 1,
    last: false,
  },
  { name: "Middle Queue Reflection", dep: "queued", n: 2, last: false },
  { name: "Last Item Projection", dep: "queued", n: 3, last: true },
];
