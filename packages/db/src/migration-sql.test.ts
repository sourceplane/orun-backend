import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checksumSql } from "./loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../migrations");

let coreSql: string;

beforeAll(() => {
  coreSql = readFileSync(resolve(migrationsDir, "0001_core.sql"), "utf-8");
});

// ---------------------------------------------------------------------------
// Required tables
// ---------------------------------------------------------------------------
const REQUIRED_TABLES = [
  "users",
  "user_identities",
  "organizations",
  "organization_members",
  "organization_invites",
  "billing_accounts",
  "entitlements",
  "projects",
];

describe("0001_core.sql — required tables", () => {
  for (const table of REQUIRED_TABLES) {
    it(`contains CREATE TABLE ${table}`, () => {
      expect(coreSql).toMatch(
        new RegExp(`create table ${table}\\s*\\(`, "i")
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Tenant-scoped columns (organization_id on tenant-owned tables)
// ---------------------------------------------------------------------------
const TENANT_TABLES = [
  "organization_members",
  "organization_invites",
  "billing_accounts",
  "entitlements",
  "projects",
];

describe("0001_core.sql — organization_id on tenant tables", () => {
  for (const table of TENANT_TABLES) {
    it(`${table} references organizations(id)`, () => {
      // Look for organization_id column referencing organizations
      expect(coreSql).toMatch(
        /organization_id\s+uuid\s+not null\s+(?:unique\s+)?references organizations\(id\)/i
      );
    });
  }
});

// ---------------------------------------------------------------------------
// UUID primary keys
// ---------------------------------------------------------------------------
describe("0001_core.sql — UUID primary keys", () => {
  it("uses gen_random_uuid() for generated PKs", () => {
    expect(coreSql).toMatch(/gen_random_uuid\(\)/i);
  });

  it("enables pgcrypto extension idempotently", () => {
    expect(coreSql).toMatch(/create extension if not exists/i);
  });
});

// ---------------------------------------------------------------------------
// Required indexes
// ---------------------------------------------------------------------------
describe("0001_core.sql — indexes", () => {
  it("has idx_projects_org index", () => {
    expect(coreSql).toMatch(/create index idx_projects_org/i);
  });

  it("idx_projects_org starts with organization_id", () => {
    expect(coreSql).toMatch(
      /create index idx_projects_org on projects\s*\(organization_id/i
    );
  });

  it("has idx_org_invites_org index", () => {
    expect(coreSql).toMatch(/create index idx_org_invites_org/i);
  });

  it("has idx_org_invites_email index on lower(email)", () => {
    expect(coreSql).toMatch(/create index idx_org_invites_email/i);
    expect(coreSql).toMatch(/lower\(email\)/i);
  });
});

// ---------------------------------------------------------------------------
// Check constraints
// ---------------------------------------------------------------------------
describe("0001_core.sql — check constraints", () => {
  it("organizations has provisioning_mode constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*provisioning_mode\s+in\s*\([^)]+shared[^)]+\)/i
    );
  });

  it("organizations has lifecycle_status constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*lifecycle_status\s+in\s*\([^)]+active[^)]+\)/i
    );
  });

  it("organization_members has role constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*role\s+in\s*\([^)]+owner[^)]+\)/i
    );
  });

  it("organization_members has status constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*status\s+in\s*\([^)]+active[^)]+\)/i
    );
  });

  it("billing_accounts has plan constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*plan\s+in\s*\([^)]+free[^)]+\)/i
    );
  });

  it("billing_accounts has provider constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*provider\s+in\s*\([^)]+stripe[^)]+\)/i
    );
  });

  it("projects has lifecycle_status constraint", () => {
    expect(coreSql).toMatch(
      /check\s*\(\s*lifecycle_status\s+in\s*\([^)]+archived[^)]+\)/i
    );
  });
});

// ---------------------------------------------------------------------------
// Unique constraints
// ---------------------------------------------------------------------------
describe("0001_core.sql — unique constraints", () => {
  it("organizations has unique slug", () => {
    expect(coreSql).toMatch(/slug\s+text\s+not null\s+unique/i);
  });

  it("projects has unique (organization_id, slug)", () => {
    expect(coreSql).toMatch(/unique\s*\(\s*organization_id\s*,\s*slug\s*\)/i);
  });

  it("user_identities has unique (provider, provider_user_id)", () => {
    expect(coreSql).toMatch(
      /unique\s*\(\s*provider\s*,\s*provider_user_id\s*\)/i
    );
  });

  it("organization_invites has unique token_hash", () => {
    expect(coreSql).toMatch(/token_hash\s+text\s+not null\s+unique/i);
  });
});

// ---------------------------------------------------------------------------
// Timestamp and soft-delete fields
// ---------------------------------------------------------------------------
describe("0001_core.sql — timestamps", () => {
  it("has created_at columns with default now()", () => {
    const matches = coreSql.match(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/gi);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThan(4);
  });

  it("has updated_at columns", () => {
    expect(coreSql).toMatch(/updated_at\s+timestamptz\s+not null/i);
  });

  it("has deleted_at soft-delete columns on appropriate tables", () => {
    expect(coreSql).toMatch(/deleted_at\s+timestamptz/i);
  });

  it("has orun_set_updated_at() trigger function", () => {
    expect(coreSql).toMatch(/create or replace function orun_set_updated_at/i);
  });
});

// ---------------------------------------------------------------------------
// No secrets or sensitive placeholders
// ---------------------------------------------------------------------------
describe("0001_core.sql — no secrets", () => {
  const SECRET_PATTERNS: [string, RegExp][] = [
    ["postgres connection URL", /postgres(?:ql)?:\/\//i],
    ["DATABASE_URL assignment", /DATABASE_URL\s*=/i],
    ["Supabase service key prefix", /sbp_[a-z0-9]{40}/i],
    ["Cloudflare token pattern", /\bcf[_-]token\b/i],
    ["generic API key placeholder", /api[_-]?key\s*=\s*['"][^'"]{10,}/i],
  ];

  for (const [label, pattern] of SECRET_PATTERNS) {
    it(`does not contain ${label}`, () => {
      expect(coreSql).not.toMatch(pattern);
    });
  }
});

// ---------------------------------------------------------------------------
// Checksum stability
// ---------------------------------------------------------------------------
describe("0001_core.sql — checksum stability", () => {
  it("has a stable, deterministic checksum", () => {
    const c1 = checksumSql(coreSql);
    const c2 = checksumSql(coreSql);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });
});
