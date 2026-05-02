import { describe, it, expect, vi, beforeEach } from "vitest";
import { R2Storage } from "./r2";

function createMockBucket() {
  const store = new Map<string, { body: unknown; httpMetadata?: unknown; customMetadata?: Record<string, string> }>();

  const bucket = {
    put: vi.fn(async (key: string, body: unknown, options?: { httpMetadata?: unknown; customMetadata?: Record<string, string> }) => {
      store.set(key, { body, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
    }),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        key,
        body: item.body,
        httpMetadata: item.httpMetadata,
        customMetadata: item.customMetadata,
        text: async () => typeof item.body === "string" ? item.body : "",
        json: async () => JSON.parse(typeof item.body === "string" ? item.body : "null"),
      };
    }),
    list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
      const prefix = options?.prefix ?? "";
      const objects = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key }));
      return { objects, truncated: false, cursor: "" };
    }),
    delete: vi.fn(async (_keys: string | string[]) => {}),
  };

  return { bucket, store };
}

describe("R2Storage", () => {
  let storage: R2Storage;
  let mockBucket: ReturnType<typeof createMockBucket>;

  beforeEach(() => {
    mockBucket = createMockBucket();
    storage = new R2Storage(mockBucket.bucket as unknown as R2Bucket);
  });

  describe("writeLog", () => {
    it("writes to the exact runLogPath", async () => {
      const key = await storage.writeLog("ns-123", "run-1", "job-a", "log content");
      expect(key).toBe("ns-123/runs/run-1/logs/job-a.log");
      expect(mockBucket.bucket.put).toHaveBeenCalledWith(
        "ns-123/runs/run-1/logs/job-a.log",
        "log content",
        expect.any(Object)
      );
    });

    it("sets text/plain content type", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "content");
      const putCall = mockBucket.bucket.put.mock.calls[0];
      expect(putCall[2]?.httpMetadata).toEqual({ contentType: "text/plain; charset=utf-8" });
    });

    it("sets expires-at metadata when expiresAt string is provided", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "content", {
        expiresAt: "2025-06-01T00:00:00.000Z",
      });
      const putCall = mockBucket.bucket.put.mock.calls[0];
      expect(putCall[2]?.customMetadata).toEqual({ "expires-at": "2025-06-01T00:00:00.000Z" });
    });

    it("sets expires-at metadata when expiresAt Date is provided", async () => {
      const date = new Date("2025-06-01T00:00:00.000Z");
      await storage.writeLog("ns-123", "run-1", "job-a", "content", {
        expiresAt: date,
      });
      const putCall = mockBucket.bucket.put.mock.calls[0];
      expect(putCall[2]?.customMetadata).toEqual({ "expires-at": "2025-06-01T00:00:00.000Z" });
    });

    it("does not set customMetadata when no expiresAt provided", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "content");
      const putCall = mockBucket.bucket.put.mock.calls[0];
      expect(putCall[2]?.customMetadata).toBeUndefined();
    });

    it("accepts ReadableStream content", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        },
      });
      const key = await storage.writeLog("ns-123", "run-1", "job-a", stream);
      expect(key).toBe("ns-123/runs/run-1/logs/job-a.log");
      expect(mockBucket.bucket.put).toHaveBeenCalled();
    });
  });

  describe("readLog", () => {
    it("returns object body when log exists", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "test log");
      const result = await storage.readLog("ns-123", "run-1", "job-a");
      expect(result).not.toBeNull();
      expect(await result!.text()).toBe("test log");
    });

    it("returns null when log does not exist", async () => {
      const result = await storage.readLog("ns-123", "run-1", "missing-job");
      expect(result).toBeNull();
    });
  });

  describe("savePlan", () => {
    const plan = {
      checksum: "abc123",
      version: "1.0",
      jobs: [{ jobId: "j1", component: "api", deps: [], steps: [] }],
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    it("writes JSON to exact planPath", async () => {
      const key = await storage.savePlan("ns-123", plan);
      expect(key).toBe("ns-123/plans/abc123.json");
      expect(mockBucket.bucket.put).toHaveBeenCalledWith(
        "ns-123/plans/abc123.json",
        JSON.stringify(plan),
        expect.objectContaining({
          httpMetadata: { contentType: "application/json; charset=utf-8" },
        })
      );
    });
  });

  describe("getPlan", () => {
    const plan = {
      checksum: "abc123",
      version: "1.0",
      jobs: [{ jobId: "j1", component: "api", deps: [], steps: [] }],
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    it("returns parsed Plan when exists", async () => {
      await storage.savePlan("ns-123", plan);
      const result = await storage.getPlan("ns-123", "abc123");
      expect(result).toEqual(plan);
    });

    it("returns null when plan does not exist", async () => {
      const result = await storage.getPlan("ns-123", "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listRunLogs", () => {
    it("uses the exact namespace/run logs prefix", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "log a");
      await storage.writeLog("ns-123", "run-1", "job-b", "log b");
      await storage.writeLog("ns-123", "run-2", "job-c", "log c");

      const logs = await storage.listRunLogs("ns-123", "run-1");
      expect(logs).toContain("ns-123/runs/run-1/logs/job-a.log");
      expect(logs).toContain("ns-123/runs/run-1/logs/job-b.log");
      expect(logs).not.toContain("ns-123/runs/run-2/logs/job-c.log");
    });

    it("calls bucket.list with correct prefix", async () => {
      await storage.listRunLogs("ns-456", "run-x");
      expect(mockBucket.bucket.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: "ns-456/runs/run-x/logs/" })
      );
    });

    it("handles pagination", async () => {
      let callCount = 0;
      mockBucket.bucket.list.mockImplementation(async (opts?: { prefix?: string; cursor?: string }) => {
        callCount++;
        if (callCount === 1) {
          return {
            objects: [{ key: "ns-123/runs/run-1/logs/job-a.log" }],
            truncated: true,
            cursor: "page2",
          };
        }
        return {
          objects: [{ key: "ns-123/runs/run-1/logs/job-b.log" }],
          truncated: false,
          cursor: "",
        };
      });

      const logs = await storage.listRunLogs("ns-123", "run-1");
      expect(logs).toHaveLength(2);
      expect(callCount).toBe(2);
    });
  });

  describe("deleteRun", () => {
    it("deletes only keys under namespaceId/runs/runId/", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "log");
      await storage.writeLog("ns-123", "run-2", "job-b", "log");

      await storage.deleteRun("ns-123", "run-1");

      expect(mockBucket.bucket.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: "ns-123/runs/run-1/" })
      );
    });

    it("handles pagination during delete", async () => {
      let callCount = 0;
      mockBucket.bucket.list.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            objects: [{ key: "ns-123/runs/run-1/logs/job-a.log" }],
            truncated: true,
            cursor: "page2",
          };
        }
        return {
          objects: [{ key: "ns-123/runs/run-1/logs/job-b.log" }],
          truncated: false,
          cursor: "",
        };
      });

      await storage.deleteRun("ns-123", "run-1");
      expect(mockBucket.bucket.delete).toHaveBeenCalledTimes(2);
    });

    it("does not cross namespace boundaries", async () => {
      await storage.writeLog("ns-123", "run-1", "job-a", "log");
      await storage.writeLog("ns-OTHER", "run-1", "job-a", "log");

      await storage.deleteRun("ns-123", "run-1");

      expect(mockBucket.bucket.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: "ns-123/runs/run-1/" })
      );
      const listCalls = mockBucket.bucket.list.mock.calls;
      for (const call of listCalls) {
        expect((call[0] as { prefix?: string })?.prefix).toContain("ns-123");
      }
    });
  });

  describe("namespace isolation", () => {
    it("no R2 operation crosses namespace boundaries", async () => {
      await storage.writeLog("ns-A", "run-1", "job-1", "log A");
      await storage.writeLog("ns-B", "run-1", "job-1", "log B");

      const logA = await storage.readLog("ns-A", "run-1", "job-1");
      expect(await logA!.text()).toBe("log A");

      const logB = await storage.readLog("ns-B", "run-1", "job-1");
      expect(await logB!.text()).toBe("log B");

      const logsA = await storage.listRunLogs("ns-A", "run-1");
      expect(logsA).toEqual(["ns-A/runs/run-1/logs/job-1.log"]);

      const logsB = await storage.listRunLogs("ns-B", "run-1");
      expect(logsB).toEqual(["ns-B/runs/run-1/logs/job-1.log"]);
    });
  });
});
