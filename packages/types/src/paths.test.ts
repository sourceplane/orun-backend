import { describe, it, expect } from "vitest";
import { runLogPath, planPath, coordinatorKey } from "./paths";

describe("runLogPath", () => {
  it("returns correct R2 path for job log", () => {
    expect(runLogPath("123", "run-1", "job-a")).toBe("123/runs/run-1/logs/job-a.log");
  });
});

describe("planPath", () => {
  it("returns correct R2 path for plan snapshot", () => {
    expect(planPath("123", "abc")).toBe("123/plans/abc.json");
  });
});

describe("coordinatorKey", () => {
  it("returns correct DO key for run coordinator", () => {
    expect(coordinatorKey("123", "run-1")).toBe("123:run-1");
  });
});
