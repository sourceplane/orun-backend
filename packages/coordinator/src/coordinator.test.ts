import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunCoordinator } from "./coordinator";
import type { Plan } from "@orun/types";

function makePlan(
  jobs: Array<{ jobId: string; component: string; deps?: string[] }>,
): Plan {
  return {
    checksum: "abc123",
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    jobs: jobs.map((j) => ({
      jobId: j.jobId,
      component: j.component,
      deps: j.deps ?? [],
      steps: [],
    })),
  };
}

class FakeStorage {
  private data = new Map<string, unknown>();
  private alarmTime: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async deleteAll(): Promise<void> {
    this.data.clear();
    this.alarmTime = null;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmTime;
  }

  async setAlarm(time: number): Promise<void> {
    this.alarmTime = time;
  }

  getAlarmSync(): number | null {
    return this.alarmTime;
  }

  getDataSync(): Map<string, unknown> {
    return this.data;
  }
}

function createCoordinator(): {
  coordinator: RunCoordinator;
  storage: FakeStorage;
} {
  const storage = new FakeStorage();
  const fakeState = { storage } as unknown as DurableObjectState;
  const coordinator = new RunCoordinator(fakeState, {});
  return { coordinator, storage };
}

function req(
  method: string,
  path: string,
  body?: unknown,
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://fake-host${path}`, init);
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

const simplePlan = makePlan([
  { jobId: "a", component: "api" },
  { jobId: "b", component: "web", deps: ["a"] },
]);

const initBody = {
  plan: simplePlan,
  runId: "run-1",
  namespaceId: "ns-1",
  namespaceSlug: "org/repo",
};

async function initCoordinator(
  coordinator: RunCoordinator,
  body = initBody,
): Promise<Response> {
  return coordinator.fetch(req("POST", "/init", body));
}

describe("RunCoordinator", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("POST /init", () => {
    it("creates state from a plan", async () => {
      const { coordinator } = createCoordinator();
      const res = await initCoordinator(coordinator);
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toEqual({ ok: true, alreadyExists: false });

      const stateRes = await coordinator.fetch(req("GET", "/state"));
      const state = (await json(stateRes)) as Record<string, unknown>;
      expect(state).toMatchObject({
        runId: "run-1",
        namespaceId: "ns-1",
        status: "running",
      });
      expect(Object.keys(state.jobs as Record<string, unknown>)).toEqual([
        "a",
        "b",
      ]);
    });

    it("is idempotent for the same runId", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await initCoordinator(coordinator);
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true, alreadyExists: true });
    });

    it("rejects init for a different runId", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await initCoordinator(coordinator, {
        ...initBody,
        runId: "run-2",
      });
      expect(res.status).toBe(409);
    });

    it("rejects duplicate jobIds", async () => {
      const { coordinator } = createCoordinator();
      const plan = makePlan([
        { jobId: "x", component: "api" },
        { jobId: "x", component: "web" },
      ]);
      const res = await initCoordinator(coordinator, {
        ...initBody,
        plan,
      });
      expect(res.status).toBe(400);
      const body = (await json(res)) as { error: string };
      expect(body.error).toContain("Duplicate jobId");
    });

    it("rejects dependencies that reference missing jobs", async () => {
      const { coordinator } = createCoordinator();
      const plan = makePlan([
        { jobId: "a", component: "api", deps: ["nonexistent"] },
      ]);
      const res = await initCoordinator(coordinator, {
        ...initBody,
        plan,
      });
      expect(res.status).toBe(400);
      const body = (await json(res)) as { error: string };
      expect(body.error).toContain("nonexistent");
    });

    it("rejects missing required fields", async () => {
      const { coordinator } = createCoordinator();
      const res = await coordinator.fetch(
        req("POST", "/init", { plan: simplePlan }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects non-array plan.jobs", async () => {
      const { coordinator } = createCoordinator();
      const res = await coordinator.fetch(
        req("POST", "/init", {
          ...initBody,
          plan: { ...simplePlan, jobs: "not-an-array" },
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("POST /jobs/:jobId/claim", () => {
    it("succeeds for a dependency-free pending job", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as { claimed: boolean };
      expect(body.claimed).toBe(true);
    });

    it("is rejected when dependencies are not complete (waiting)", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await coordinator.fetch(
        req("POST", "/jobs/b/claim", { runnerId: "r1" }),
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as {
        claimed: boolean;
        depsWaiting?: boolean;
      };
      expect(body.claimed).toBe(false);
      expect(body.depsWaiting).toBe(true);
    });

    it("is rejected when a dependency failed (blocked)", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "failed",
          error: "build error",
        }),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/b/claim", { runnerId: "r2" }),
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as {
        claimed: boolean;
        depsBlocked?: boolean;
      };
      expect(body.claimed).toBe(false);
      expect(body.depsBlocked).toBe(true);
    });

    it("is rejected when another runner has a fresh heartbeat", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r2" }),
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as {
        claimed: boolean;
        currentStatus?: string;
      };
      expect(body.claimed).toBe(false);
      expect(body.currentStatus).toBe("running");
    });

    it("returns terminal status for completed jobs", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "success",
        }),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r2" }),
      );
      const body = (await json(res)) as { currentStatus?: string };
      expect(body.currentStatus).toBe("success");
    });

    it("rejects claim for nonexistent job", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await coordinator.fetch(
        req("POST", "/jobs/nonexistent/claim", { runnerId: "r1" }),
      );
      expect(res.status).toBe(404);
    });

    it("rejects claim without runnerId", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await coordinator.fetch(req("POST", "/jobs/a/claim", {}));
      expect(res.status).toBe(400);
    });

    it("rejects claim on uninitialized coordinator", async () => {
      const { coordinator } = createCoordinator();
      const res = await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /jobs/:jobId/heartbeat", () => {
    it("updates the timestamp for the owning runner", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/heartbeat", { runnerId: "r1" }),
      );
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true });

      const statusRes = await coordinator.fetch(
        req("GET", "/jobs/a/status"),
      );
      const status = (await json(statusRes)) as { heartbeatAt: string };
      expect(status.heartbeatAt).toBe("2026-01-01T00:01:00.000Z");

      vi.useRealTimers();
    });

    it("tells stale owners to abort after takeover", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      vi.setSystemTime(
        new Date("2026-01-01T00:06:00.000Z"),
      );

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r2" }),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/heartbeat", { runnerId: "r1" }),
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as { ok: boolean; abort?: boolean };
      expect(body.ok).toBe(false);
      expect(body.abort).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("takeover", () => {
    it("succeeds after a 5 minute heartbeat timeout", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      vi.setSystemTime(
        new Date("2026-01-01T00:06:00.000Z"),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r2" }),
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as {
        claimed: boolean;
        takeover?: boolean;
      };
      expect(body.claimed).toBe(true);
      expect(body.takeover).toBe(true);

      const statusRes = await coordinator.fetch(
        req("GET", "/jobs/a/status"),
      );
      const status = (await json(statusRes)) as { runnerId: string };
      expect(status.runnerId).toBe("r2");

      vi.useRealTimers();
    });

    it("does not takeover before timeout", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      vi.setSystemTime(
        new Date("2026-01-01T00:04:59.000Z"),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r2" }),
      );
      const body = (await json(res)) as { claimed: boolean };
      expect(body.claimed).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("POST /jobs/:jobId/update", () => {
    it("rejects update by non-owner", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r2",
          status: "success",
        }),
      );
      expect(res.status).toBe(400);
      const body = (await json(res)) as { error: string };
      expect(body.error).toContain("does not own");
    });

    it("completes the run when all jobs succeed", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "success",
        }),
      );

      await coordinator.fetch(
        req("POST", "/jobs/b/claim", { runnerId: "r2" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/b/update", {
          runnerId: "r2",
          status: "success",
        }),
      );

      const stateRes = await coordinator.fetch(req("GET", "/state"));
      const state = (await json(stateRes)) as { status: string };
      expect(state.status).toBe("completed");
    });

    it("propagates failed status to runState", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "failed",
          error: "build broke",
        }),
      );

      const stateRes = await coordinator.fetch(req("GET", "/state"));
      const state = (await json(stateRes)) as { status: string };
      expect(state.status).toBe("failed");
    });

    it("schedules expiry alarm on completion", async () => {
      const { coordinator, storage } = createCoordinator();
      const plan = makePlan([{ jobId: "a", component: "api" }]);
      await initCoordinator(coordinator, {
        ...initBody,
        plan,
      });

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "success",
        }),
      );

      expect(storage.getAlarmSync()).not.toBeNull();
    });

    it("rejects update on non-running job", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      const res = await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "success",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("GET /runnable", () => {
    it("returns the correct subset of runnable jobs", async () => {
      const { coordinator } = createCoordinator();
      const plan = makePlan([
        { jobId: "a", component: "api" },
        { jobId: "b", component: "web", deps: ["a"] },
        { jobId: "c", component: "db" },
      ]);
      await initCoordinator(coordinator, {
        ...initBody,
        plan,
      });

      const res = await coordinator.fetch(req("GET", "/runnable"));
      const body = (await json(res)) as { jobs: string[] };
      expect(body.jobs.sort()).toEqual(["a", "c"]);
    });

    it("excludes jobs blocked by failed deps", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );
      await coordinator.fetch(
        req("POST", "/jobs/a/update", {
          runnerId: "r1",
          status: "failed",
        }),
      );

      const res = await coordinator.fetch(req("GET", "/runnable"));
      const body = (await json(res)) as { jobs: string[] };
      expect(body.jobs).toEqual([]);
    });
  });

  describe("POST /cancel", () => {
    it("cancels run and marks pending/running jobs failed", async () => {
      const { coordinator, storage } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      const res = await coordinator.fetch(req("POST", "/cancel"));
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true });

      const stateRes = await coordinator.fetch(req("GET", "/state"));
      const state = (await json(stateRes)) as {
        status: string;
        jobs: Record<string, { status: string; lastError: string | null }>;
      };
      expect(state.status).toBe("cancelled");
      expect(state.jobs.a.status).toBe("failed");
      expect(state.jobs.a.lastError).toBe("cancelled");
      expect(state.jobs.b.status).toBe("failed");
      expect(state.jobs.b.lastError).toBe("cancelled");
      expect(storage.getAlarmSync()).not.toBeNull();
    });
  });

  describe("alarm()", () => {
    it("deletes storage and clears in-memory state", async () => {
      const { coordinator, storage } = createCoordinator();
      await initCoordinator(coordinator);

      await coordinator.alarm();

      expect(storage.getDataSync().size).toBe(0);

      const stateRes = await coordinator.fetch(req("GET", "/state"));
      expect(stateRes.status).toBe(404);
    });
  });

  describe("concurrent claim", () => {
    it("only one runner gets claimed: true for the same job", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      const [res1, res2] = await Promise.all([
        coordinator.fetch(
          req("POST", "/jobs/a/claim", { runnerId: "r1" }),
        ),
        coordinator.fetch(
          req("POST", "/jobs/a/claim", { runnerId: "r2" }),
        ),
      ]);

      const body1 = (await json(res1)) as { claimed: boolean };
      const body2 = (await json(res2)) as { claimed: boolean };

      const claims = [body1.claimed, body2.claimed];
      expect(claims.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("GET /jobs/:jobId/status", () => {
    it("returns job state", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      const res = await coordinator.fetch(req("GET", "/jobs/a/status"));
      expect(res.status).toBe(200);
      const body = (await json(res)) as {
        jobId: string;
        status: string;
        component: string;
      };
      expect(body.jobId).toBe("a");
      expect(body.status).toBe("pending");
      expect(body.component).toBe("api");
    });

    it("returns 404 for unknown job", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);

      const res = await coordinator.fetch(
        req("GET", "/jobs/nonexistent/status"),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("routing errors", () => {
    it("returns 404 for unknown route", async () => {
      const { coordinator } = createCoordinator();
      const res = await coordinator.fetch(req("GET", "/unknown"));
      expect(res.status).toBe(404);
    });

    it("returns 400 for wrong method on known route", async () => {
      const { coordinator } = createCoordinator();
      await initCoordinator(coordinator);
      const res = await coordinator.fetch(req("GET", "/jobs/a/claim"));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const { coordinator } = createCoordinator();
      const res = await coordinator.fetch(
        new Request("http://fake-host/init", {
          method: "POST",
          body: "not-json",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("state persistence", () => {
    it("persists state across reloads from storage", async () => {
      const storage = new FakeStorage();
      const fakeState = { storage } as unknown as DurableObjectState;

      const coordinator1 = new RunCoordinator(fakeState, {});
      await initCoordinator(coordinator1);
      await coordinator1.fetch(
        req("POST", "/jobs/a/claim", { runnerId: "r1" }),
      );

      const coordinator2 = new RunCoordinator(fakeState, {});
      const stateRes = await coordinator2.fetch(req("GET", "/state"));
      const state = (await json(stateRes)) as {
        jobs: Record<string, { status: string; runnerId: string | null }>;
      };
      expect(state.jobs.a.status).toBe("running");
      expect(state.jobs.a.runnerId).toBe("r1");
    });
  });
});
