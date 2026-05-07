import { describe, it, expect } from "vitest";
import { runLogPath, planPath, coordinatorKey, catalogEnvelopePath, catalogComponentStatePath } from "./paths";

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

describe("catalogEnvelopePath", () => {
  it("returns correct R2 path for catalog sync envelope", () => {
    expect(catalogEnvelopePath("987", "upl_abc123")).toBe(
      "987/catalog/uploads/upl_abc123/catalog-sync-envelope.json"
    );
  });

  it("starts with the namespace ID", () => {
    const path = catalogEnvelopePath("ns-42", "upload-1");
    expect(path.startsWith("ns-42/")).toBe(true);
  });
});

describe("catalogComponentStatePath", () => {
  it("returns correct R2 path for component state snapshot", () => {
    expect(catalogComponentStatePath("987", "abc123def", "api-worker")).toBe(
      "987/catalog/commits/abc123def/components/api-worker.json"
    );
  });

  it("starts with the namespace ID", () => {
    const path = catalogComponentStatePath("ns-1", "sha", "my-component");
    expect(path.startsWith("ns-1/")).toBe(true);
  });
});
