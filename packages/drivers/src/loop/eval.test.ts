import { describe, expect, it } from "vitest";
import { buildLoopGoldenEvalReport } from "./eval.js";

describe("thoth.loop golden eval", () => {
  it("passes the deterministic Loop behavior and skill checks", () => {
    const report = buildLoopGoldenEvalReport();

    expect(report.passed).toBe(true);
    expect(report.scenarioCount).toBeGreaterThanOrEqual(12);
    expect(report.results.flatMap((entry) => entry.failures)).toEqual([]);
  });
});
