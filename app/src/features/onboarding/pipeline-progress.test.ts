import type { OrganizeStatus } from "@/api/kalaidoscope/organize";
import { organizeStage, pipelineProgress } from "./pipeline-progress";

function status(over: {
  fragments?: number;
  importsPending?: number;
  map?: Partial<OrganizeStatus["map"]>;
  discover?: Partial<OrganizeStatus["discover"]>;
}): OrganizeStatus {
  return {
    fragments: over.fragments ?? 0,
    imports: { pending: over.importsPending ?? 0 },
    map: {
      state: "settled",
      version: 1,
      annotated: 0,
      pendingAnnotation: 0,
      unfolded: 0,
      ...over.map,
    },
    discover: {
      state: "settled",
      pending: [],
      due: [],
      runs: {},
      proposals: { projections: 0, reflections: 0 },
      ...over.discover,
    },
    policy: { wave: false },
  };
}

describe("organizeStage", () => {
  it("is blank until the first status arrives", () => {
    expect(organizeStage(null)).toBe("");
  });

  it("is importing while an ingest row is pending", () => {
    expect(
      organizeStage(
        status({ importsPending: 1, map: { state: "annotating" } }),
      ),
    ).toBe("importing");
  });

  it("is mapping while annotating or consolidating", () => {
    expect(organizeStage(status({ map: { state: "annotating" } }))).toBe(
      "mapping",
    );
    expect(organizeStage(status({ map: { state: "consolidating" } }))).toBe(
      "mapping",
    );
  });

  it("is organizing while colours discovery runs or waits", () => {
    expect(
      organizeStage(
        status({ discover: { state: "running", running: "colours" } }),
      ),
    ).toBe("organizing");
    expect(
      organizeStage(
        status({
          discover: { state: "pending", pending: ["colours", "projections"] },
        }),
      ),
    ).toBe("organizing");
  });

  it("is idle once colours is done, while later kinds still run or wait", () => {
    expect(
      organizeStage(
        status({
          discover: {
            state: "running",
            running: "projections",
            pending: ["reflections"],
          },
        }),
      ),
    ).toBe("idle");
    expect(
      organizeStage(
        status({ discover: { state: "pending", pending: ["reflections"] } }),
      ),
    ).toBe("idle");
  });

  it("is idle when nothing moves, even with work left over", () => {
    expect(organizeStage(status({}))).toBe("idle");
    expect(
      organizeStage(
        status({
          map: { state: "unannotated", pendingAnnotation: 3 },
          discover: { state: "due", due: ["colours"] },
        }),
      ),
    ).toBe("idle");
  });
});

describe("pipelineProgress", () => {
  it("reports a small head start before the first status", () => {
    expect(pipelineProgress(null)).toBe(0.05);
  });

  it("stays at the head start while importing", () => {
    expect(pipelineProgress(status({ importsPending: 1 }))).toBe(0.05);
  });

  it("sits at the start of the mapping band before anything is annotated", () => {
    expect(
      pipelineProgress(
        status({ fragments: 100, map: { state: "annotating" } }),
      ),
    ).toBeCloseTo(0.1);
  });

  it("advances through the mapping band with annotated fragments", () => {
    expect(
      pipelineProgress(
        status({
          fragments: 100,
          map: { state: "annotating", annotated: 50 },
        }),
      ),
    ).toBeCloseTo(0.4);
  });

  it("never leaves the mapping band, whatever the counts say", () => {
    expect(
      pipelineProgress(
        status({
          fragments: 100,
          map: { state: "annotating", annotated: 300 },
        }),
      ),
    ).toBeCloseTo(0.7);
  });

  it("ignores a zero total rather than dividing by it", () => {
    expect(
      pipelineProgress(
        status({ fragments: 0, map: { state: "annotating", annotated: 4 } }),
      ),
    ).toBeCloseTo(0.1);
  });

  it("advances through the organizing band with the colours run's rounds", () => {
    expect(
      pipelineProgress(
        status({
          discover: {
            state: "running",
            running: "colours",
            runs: {
              colours: { id: "r", status: "running", rounds: 15, finished: "" },
            },
          },
        }),
      ),
    ).toBeCloseTo(0.825);
  });

  it("caps the organizing band at the round budget", () => {
    expect(
      pipelineProgress(
        status({
          discover: {
            state: "running",
            running: "colours",
            runs: {
              colours: { id: "r", status: "running", rounds: 40, finished: "" },
            },
          },
        }),
      ),
    ).toBeCloseTo(0.95);
  });

  it("starts the organizing band while kinds are only queued", () => {
    expect(
      pipelineProgress(
        status({ discover: { state: "pending", pending: ["colours"] } }),
      ),
    ).toBeCloseTo(0.7);
  });

  it("completes when idle", () => {
    expect(pipelineProgress(status({}))).toBe(1);
  });
});
