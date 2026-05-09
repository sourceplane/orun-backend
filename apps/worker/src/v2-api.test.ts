import { describe, it, expect } from "vitest";
import { handleV2Me } from "./handlers/v2/me";
import { handleCreateOrg, handleListOrgs, handleGetOrg } from "./handlers/v2/organizations";
import { handleCreateProject, handleListProjects, handleGetProject } from "./handlers/v2/projects";
import type { RequestContextV2 } from "./auth/v2";
import type { DbClient, DbQueryResult } from "@orun/db/runtime";

// ─── Fake DbClient helpers ────────────────────────────────────────────────────

function fakeDb(responses: { rows: unknown[] }[]): DbClient {
  let idx = 0;
  const db: DbClient = {
    async query<R>(): Promise<DbQueryResult<R>> {
      const res = responses[idx++] ?? { rows: [] };
      return { rows: res.rows as R[] };
    },
    async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
      return fn(db);
    },
  };
  return db;
}

function emptyDb(): DbClient {
  return fakeDb([]);
}

// ─── Fake auth contexts ───────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID  = "22222222-2222-2222-2222-222222222222";
const PROJ_ID = "33333333-3333-3333-3333-333333333333";

function dashboardCtx(overrides: Partial<RequestContextV2> = {}): RequestContextV2 {
  return {
    authKind: "dashboard",
    actorType: "user",
    userId: USER_ID,
    githubLogin: "testuser",
    actorLabel: "testuser",
    ...overrides,
  };
}

function nowIso() { return new Date().toISOString(); }

// ─── /v2/me ───────────────────────────────────────────────────────────────────

describe("handleV2Me", () => {
  it("returns user and organizations", async () => {
    const userRow = {
      id: USER_ID, email: "test@example.com", display_name: "Test User",
      avatar_url: null, created_at: new Date(), updated_at: new Date(),
    };
    const orgRow = {
      organization: {
        id: ORG_ID, slug: "my-org", name: "My Org",
        lifecycle_status: "active", created_at: new Date(), updated_at: new Date(),
      },
      role: "owner" as const,
    };
    const db = fakeDb([{ rows: [userRow] }, { rows: [orgRow] }]);

    const req = new Request("https://api.orun.test/v2/me");
    const resp = await handleV2Me(req, dashboardCtx(), db);
    expect(resp.status).toBe(200);

    const body = await resp.json() as any;
    expect(body.user.id).toBe(USER_ID);
    expect(body.user.email).toBe("test@example.com");
    expect(body.user.githubLogin).toBe("testuser");
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].role).toBe("owner");
    expect(body.organizations[0].permissions).toContain("org.view");
  });

  it("throws UNAUTHORIZED when userId is missing", async () => {
    const req = new Request("https://api.orun.test/v2/me");
    const ctx = dashboardCtx({ userId: undefined });
    await expect(handleV2Me(req, ctx, emptyDb())).rejects.toThrow("User identity required");
  });

  it("throws NOT_FOUND when user does not exist in DB", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [] }]);
    const req = new Request("https://api.orun.test/v2/me");
    await expect(handleV2Me(req, dashboardCtx(), db)).rejects.toThrow("User not found");
  });
});

// ─── /v2/organizations ────────────────────────────────────────────────────────

describe("handleCreateOrg", () => {
  it("creates org and returns 201", async () => {
    const orgRow = {
      id: ORG_ID, slug: "new-org", name: "New Org",
      lifecycle_status: "active", created_at: new Date(), updated_at: new Date(),
    };
    // transaction: createOrg emits multiple queries; return org on first
    const db = fakeDb([{ rows: [orgRow] }, { rows: [] }, { rows: [] }, { rows: [] }]);

    const req = new Request("https://api.orun.test/v2/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "New Org", slug: "new-org" }),
    });
    const resp = await handleCreateOrg(req, dashboardCtx(), db);
    expect(resp.status).toBe(201);

    const body = await resp.json() as any;
    expect(body.slug).toBe("new-org");
    expect(body.name).toBe("New Org");
  });

  it("returns 400 for missing name", async () => {
    const req = new Request("https://api.orun.test/v2/organizations", {
      method: "POST",
      body: JSON.stringify({ slug: "no-name" }),
    });
    const resp = await handleCreateOrg(req, dashboardCtx(), emptyDb());
    expect(resp.status).toBe(400);
    const body = await resp.json() as any;
    expect(body.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for invalid slug", async () => {
    const req = new Request("https://api.orun.test/v2/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Test", slug: "INVALID SLUG!" }),
    });
    const resp = await handleCreateOrg(req, dashboardCtx(), emptyDb());
    expect(resp.status).toBe(400);
  });

  it("returns 409 for duplicate slug", async () => {
    const db: DbClient = {
      async query<R>(): Promise<DbQueryResult<R>> {
        throw new Error("duplicate key value violates unique constraint");
      },
      async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
        return fn(db);
      },
    };
    const req = new Request("https://api.orun.test/v2/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Dupe", slug: "dupe-org" }),
    });
    const resp = await handleCreateOrg(req, dashboardCtx(), db);
    expect(resp.status).toBe(409);
  });

  it("throws UNAUTHORIZED when userId is missing", async () => {
    const req = new Request("https://api.orun.test/v2/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "X", slug: "x" }),
    });
    const ctx = dashboardCtx({ userId: undefined });
    await expect(handleCreateOrg(req, ctx, emptyDb())).rejects.toThrow("User identity required");
  });
});

describe("handleListOrgs", () => {
  it("returns organization list for user", async () => {
    // listOrgsForUser queries flat rows (OrganizationRow & { role, member_status })
    const flatRow = {
      id: ORG_ID, slug: "my-org", name: "My Org",
      lifecycle_status: "active", created_at: new Date(), updated_at: new Date(),
      role: "member" as const, member_status: "active",
    };
    const db = fakeDb([{ rows: [flatRow] }]);
    const req = new Request("https://api.orun.test/v2/organizations");
    const resp = await handleListOrgs(req, dashboardCtx(), db);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].role).toBe("member");
    expect(body.organizations[0].permissions).toContain("org.view");
    expect(body.organizations[0].permissions).not.toContain("org.delete");
  });
});

describe("handleGetOrg", () => {
  it("returns org detail when member exists", async () => {
    // requireOrgPermission → getMembership: 1 query
    // getOrgDetail: org query, member query, billing query = 3 queries
    const membershipRow = { role: "owner", organization_id: ORG_ID, user_id: USER_ID, status: "active" };
    const orgRow = {
      id: ORG_ID, slug: "my-org", name: "My Org",
      lifecycle_status: "active", created_at: new Date(), updated_at: new Date(),
    };
    const billingRow = { plan: "free", status: "active" };
    const db = fakeDb([
      { rows: [membershipRow] },  // getMembership (requireOrgPermission)
      { rows: [orgRow] },          // getOrgDetail: org
      { rows: [membershipRow] },  // getOrgDetail: member
      { rows: [billingRow] },      // getOrgDetail: billing
    ]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}`);
    const resp = await handleGetOrg(req, dashboardCtx(), db, ORG_ID);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.id).toBe(ORG_ID);
    expect(body.billingPlan).toBe("free");
  });

  it("returns 400 for invalid org ID", async () => {
    const req = new Request("https://api.orun.test/v2/organizations/not-a-uuid");
    const resp = await handleGetOrg(req, dashboardCtx(), emptyDb(), "not-a-uuid");
    expect(resp.status).toBe(400);
  });

  it("throws FORBIDDEN when not a member", async () => {
    const db = fakeDb([{ rows: [] }]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}`);
    await expect(handleGetOrg(req, dashboardCtx(), db, ORG_ID)).rejects.toThrow("Not a member");
  });

  it("returns 404 when org not found (no detail row)", async () => {
    const membershipRow = { role: "owner", organization_id: ORG_ID, user_id: USER_ID, status: "active" };
    // requireOrgPermission finds membership, getOrgDetail finds no org
    const db = fakeDb([{ rows: [membershipRow] }, { rows: [] }]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}`);
    const resp = await handleGetOrg(req, dashboardCtx(), db, ORG_ID);
    expect(resp.status).toBe(404);
  });
});

// ─── /v2/organizations/:orgId/projects ───────────────────────────────────────

describe("handleCreateProject", () => {
  it("creates project and returns 201", async () => {
    const membership = { role: "owner" as const };
    const projectRow = {
      id: PROJ_ID, organization_id: ORG_ID, slug: "my-proj", name: "My Project",
      description: null, lifecycle_status: "active",
      created_at: new Date(), updated_at: new Date(),
    };
    const db = fakeDb([{ rows: [membership] }, { rows: [projectRow] }, { rows: [] }]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}/projects`, {
      method: "POST",
      body: JSON.stringify({ name: "My Project", slug: "my-proj" }),
    });
    const resp = await handleCreateProject(req, dashboardCtx(), db, ORG_ID);
    expect(resp.status).toBe(201);
    const body = await resp.json() as any;
    expect(body.slug).toBe("my-proj");
    expect(body.organizationId).toBe(ORG_ID);
  });

  it("returns 400 for invalid org ID", async () => {
    const req = new Request("https://api.orun.test/v2/organizations/bad/projects", {
      method: "POST",
      body: JSON.stringify({ name: "X", slug: "x" }),
    });
    const resp = await handleCreateProject(req, dashboardCtx(), emptyDb(), "bad");
    expect(resp.status).toBe(400);
  });

  it("returns 409 for duplicate project slug", async () => {
    const membership = { role: "owner" as const };
    const db: DbClient = {
      async query<R>(sql: string): Promise<DbQueryResult<R>> {
        if (String(sql).includes("organization_members")) {
          return { rows: [membership] as unknown as R[] };
        }
        throw new Error("duplicate key value violates unique constraint");
      },
      async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
        return fn(db);
      },
    };
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}/projects`, {
      method: "POST",
      body: JSON.stringify({ name: "Dupe", slug: "dupe-proj" }),
    });
    const resp = await handleCreateProject(req, dashboardCtx(), db, ORG_ID);
    expect(resp.status).toBe(409);
  });
});

describe("handleListProjects", () => {
  it("returns project list for org", async () => {
    const membership = { role: "member" as const };
    const projRow = {
      id: PROJ_ID, organization_id: ORG_ID, slug: "proj-a", name: "Proj A",
      description: "desc", lifecycle_status: "active",
      created_at: new Date(), updated_at: new Date(),
    };
    const db = fakeDb([{ rows: [membership] }, { rows: [projRow] }]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}/projects`);
    const resp = await handleListProjects(req, dashboardCtx(), db, ORG_ID);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].slug).toBe("proj-a");
  });
});

describe("handleGetProject", () => {
  it("returns project when found", async () => {
    const membership = { role: "owner" as const };
    const projRow = {
      id: PROJ_ID, organization_id: ORG_ID, slug: "proj-a", name: "Proj A",
      description: null, lifecycle_status: "active",
      created_at: new Date(), updated_at: new Date(),
    };
    const db = fakeDb([{ rows: [membership] }, { rows: [projRow] }]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}/projects/${PROJ_ID}`);
    const resp = await handleGetProject(req, dashboardCtx(), db, ORG_ID, PROJ_ID);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.id).toBe(PROJ_ID);
  });

  it("returns 400 for invalid project ID", async () => {
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}/projects/bad-id`);
    const resp = await handleGetProject(req, dashboardCtx(), emptyDb(), ORG_ID, "bad-id");
    expect(resp.status).toBe(400);
  });

  it("returns 404 when project not found", async () => {
    const membership = { role: "owner" as const };
    const db = fakeDb([{ rows: [membership] }, { rows: [] }]);
    const req = new Request(`https://api.orun.test/v2/organizations/${ORG_ID}/projects/${PROJ_ID}`);
    const resp = await handleGetProject(req, dashboardCtx(), db, ORG_ID, PROJ_ID);
    expect(resp.status).toBe(404);
  });
});
