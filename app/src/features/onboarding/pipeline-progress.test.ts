import { pipelineProgress } from "./pipeline-progress";

describe("pipelineProgress", () => {
  it("reports a small head start while the upload is still processing", () => {
    expect(pipelineProgress({ stage: "" })).toBe(0.05);
  });

  it("sits at the start of the mapping band before the map has counters", () => {
    expect(pipelineProgress({ stage: "mapping" })).toBeCloseTo(0.1);
  });

  it("advances through the mapping band with annotated fragments", () => {
    expect(
      pipelineProgress({
        stage: "mapping",
        map: { annotated: 50, fragments: 100 },
      }),
    ).toBeCloseTo(0.4);
  });

  it("never leaves the mapping band, whatever the counts say", () => {
    expect(
      pipelineProgress({
        stage: "mapping",
        map: { annotated: 300, fragments: 100 },
      }),
    ).toBeCloseTo(0.7);
  });

  it("ignores a zero total rather than dividing by it", () => {
    expect(
      pipelineProgress({
        stage: "mapping",
        map: { annotated: 4, fragments: 0 },
      }),
    ).toBeCloseTo(0.1);
  });

  it("advances through the organizing band with rounds", () => {
    expect(
      pipelineProgress({
        stage: "organizing",
        discoverRun: { rounds: 15 },
      }),
    ).toBeCloseTo(0.825);
  });

  it("caps the organizing band at the round budget", () => {
    expect(
      pipelineProgress({
        stage: "organizing",
        discoverRun: { rounds: 40 },
      }),
    ).toBeCloseTo(0.95);
  });

  it("completes on done", () => {
    expect(pipelineProgress({ stage: "done" })).toBe(1);
  });

  it("holds the last band on error rather than jumping", () => {
    expect(pipelineProgress({ stage: "error" })).toBe(0.05);
  });
});
