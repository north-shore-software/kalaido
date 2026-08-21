import { pipelineProgress } from "./pipeline-progress";

describe("pipelineProgress", () => {
  it("reports a small head start while the upload is still processing", () => {
    expect(pipelineProgress({ stage: "" })).toBe(0.05);
  });

  it("sits at the start of the mapping band before a run record exists", () => {
    expect(pipelineProgress({ stage: "mapping" })).toBeCloseTo(0.1);
  });

  it("advances through the mapping band with processed fragments", () => {
    expect(
      pipelineProgress({
        stage: "mapping",
        mapRun: { fragments_processed: 50, fragments_total: 100 },
      }),
    ).toBeCloseTo(0.4);
  });

  it("never leaves the mapping band, whatever the counts say", () => {
    expect(
      pipelineProgress({
        stage: "mapping",
        mapRun: { fragments_processed: 300, fragments_total: 100 },
      }),
    ).toBeCloseTo(0.7);
  });

  it("ignores a zero total rather than dividing by it", () => {
    expect(
      pipelineProgress({
        stage: "mapping",
        mapRun: { fragments_processed: 4, fragments_total: 0 },
      }),
    ).toBeCloseTo(0.1);
  });

  it("advances through the organizing band with explorations", () => {
    expect(
      pipelineProgress({
        stage: "organizing",
        organizeRun: { explorations: 5 },
      }),
    ).toBeCloseTo(0.75);
  });

  it("caps the organizing band at the exploration budget", () => {
    expect(
      pipelineProgress({
        stage: "organizing",
        organizeRun: { explorations: 40 },
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
