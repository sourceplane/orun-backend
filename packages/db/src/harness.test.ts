import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checksumSql,
  loadMigrations,
  parseMigrationFilename,
} from "./loader.js";
import { applyMigrations, getMigrationStatus } from "./harness.js";
import type { DbClient, DbQueryResult, MigrationRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Minimal fake client for testing the harness without a live database
// ---------------------------------------------------------------------------
class FakeDbClient implements DbClient {
  readonly executedSql: string[] = [];
  readonly appliedRecords: MigrationRecord[] = [];

  async query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<DbQueryResult<T>> {
    this.executedSql.push(sql.trim());

    if (/create table if not exists orun_schema_migrations/i.test(sql)) {
      return { rows: [] as T[] };
    }

    if (/from orun_schema_migrations/i.test(sql)) {
      return { rows: this.appliedRecords as unknown as T[] };
    }

    if (/insert into orun_schema_migrations/i.test(sql)) {
      const [version, name, filename, checksum] = params as [
        number,
        string,
        string,
        string,
      ];
      this.appliedRecords.push({
        version,
        name,
        filename,
        checksum,
        applied_at: new Date().toISOString(),
      });
      return { rows: [] as T[] };
    }

    // All other queries (DDL from migration files, etc.)
    return { rows: [] as T[] };
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "orun-db-test-"));
}

function writeMigration(dir: string, filename: string, sql: string): void {
  writeFileSync(join(dir, filename), sql, "utf-8");
}

// ---------------------------------------------------------------------------
// checksumSql
// ---------------------------------------------------------------------------
describe("checksumSql", () => {
  it("returns the same checksum for identical SQL", () => {
    const sql = "create table foo (id uuid primary key);";
    expect(checksumSql(sql)).toBe(checksumSql(sql));
  });

  it("returns different checksums for different SQL", () => {
    expect(checksumSql("select 1")).not.toBe(checksumSql("select 2"));
  });

  it("returns a 64-character hex string", () => {
    expect(checksumSql("select 1")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// parseMigrationFilename
// ---------------------------------------------------------------------------
describe("parseMigrationFilename", () => {
  it("parses a valid filename", () => {
    expect(parseMigrationFilename("0001_core.sql")).toEqual({
      version: 1,
      name: "core",
    });
  });

  it("parses multi-word names", () => {
    expect(parseMigrationFilename("0002_auth_membership.sql")).toEqual({
      version: 2,
      name: "auth_membership",
    });
  });

  it("returns null for invalid filenames", () => {
    expect(parseMigrationFilename("core.sql")).toBeNull();
    expect(parseMigrationFilename("0001.sql")).toBeNull();
    expect(parseMigrationFilename("notasql.txt")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadMigrations
// ---------------------------------------------------------------------------
describe("loadMigrations", () => {
  it("returns migrations sorted by version", () => {
    const dir = makeTempDir();
    writeMigration(dir, "0002_second.sql", "select 2");
    writeMigration(dir, "0001_first.sql", "select 1");

    const migrations = loadMigrations(dir);
    expect(migrations.map((m) => m.version)).toEqual([1, 2]);
    expect(migrations[0].name).toBe("first");
    expect(migrations[1].name).toBe("second");
  });

  it("computes stable checksums", () => {
    const dir = makeTempDir();
    const sql = "create table foo (id uuid primary key);";
    writeMigration(dir, "0001_foo.sql", sql);

    const [m] = loadMigrations(dir);
    expect(m.checksum).toBe(checksumSql(sql));
  });

  it("throws on duplicate version numbers", () => {
    const dir = makeTempDir();
    writeMigration(dir, "0001_alpha.sql", "select 1");
    writeMigration(dir, "0001_beta.sql", "select 2");

    expect(() => loadMigrations(dir)).toThrow(/Duplicate migration version 1/);
  });

  it("ignores non-SQL files", () => {
    const dir = makeTempDir();
    writeMigration(dir, "0001_core.sql", "select 1");
    writeFileSync(join(dir, "README.md"), "# notes");

    const migrations = loadMigrations(dir);
    expect(migrations).toHaveLength(1);
  });

  it("returns an empty array for an empty directory", () => {
    const dir = makeTempDir();
    expect(loadMigrations(dir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyMigrations
// ---------------------------------------------------------------------------
describe("applyMigrations", () => {
  let client: FakeDbClient;

  beforeEach(() => {
    client = new FakeDbClient();
  });

  it("creates the migrations table", async () => {
    await applyMigrations(client, []);
    expect(
      client.executedSql.some((s) =>
        /create table if not exists orun_schema_migrations/i.test(s)
      )
    ).toBe(true);
  });

  it("applies pending migrations in order and records them", async () => {
    const migrations = [
      {
        version: 1,
        name: "first",
        filename: "0001_first.sql",
        sql: "create table a (id text);",
        checksum: checksumSql("create table a (id text);"),
      },
      {
        version: 2,
        name: "second",
        filename: "0002_second.sql",
        sql: "create table b (id text);",
        checksum: checksumSql("create table b (id text);"),
      },
    ];

    await applyMigrations(client, migrations);

    expect(client.appliedRecords).toHaveLength(2);
    expect(client.appliedRecords[0].version).toBe(1);
    expect(client.appliedRecords[1].version).toBe(2);
    expect(client.appliedRecords[0].checksum).toBe(migrations[0].checksum);
  });

  it("skips already-applied migrations", async () => {
    const migration = {
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      sql: "create table a (id text);",
      checksum: checksumSql("create table a (id text);"),
    };

    // Pre-populate as already applied
    client.appliedRecords.push({
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      checksum: migration.checksum,
      applied_at: new Date().toISOString(),
    });

    await applyMigrations(client, [migration]);

    // Still only 1 record (not inserted again)
    expect(client.appliedRecords).toHaveLength(1);
    // Migration DDL should not have been re-executed
    const ddlCalls = client.executedSql.filter((s) =>
      s.includes("create table a")
    );
    expect(ddlCalls).toHaveLength(0);
  });

  it("throws on checksum mismatch before applying new migrations", async () => {
    const originalSql = "create table a (id text);";
    const migration = {
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      sql: "create table a (id text modified);",
      checksum: checksumSql("create table a (id text modified);"),
    };

    client.appliedRecords.push({
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      checksum: checksumSql(originalSql),
      applied_at: new Date().toISOString(),
    });

    await expect(applyMigrations(client, [migration])).rejects.toThrow(
      /Checksum mismatch.*0001_first\.sql/
    );
  });

  it("applies only the pending migration when one is already applied", async () => {
    const m1 = {
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      sql: "create table a (id text);",
      checksum: checksumSql("create table a (id text);"),
    };
    const m2 = {
      version: 2,
      name: "second",
      filename: "0002_second.sql",
      sql: "create table b (id text);",
      checksum: checksumSql("create table b (id text);"),
    };

    client.appliedRecords.push({
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      checksum: m1.checksum,
      applied_at: new Date().toISOString(),
    });

    await applyMigrations(client, [m1, m2]);

    // Only m2 should have been inserted
    const inserted = client.appliedRecords.filter(
      (r) => r.version === 2 && r.filename === "0002_second.sql"
    );
    expect(inserted).toHaveLength(1);
    // m1 should not have been re-inserted
    const m1Inserts = client.appliedRecords.filter(
      (r) => r.version === 1
    );
    expect(m1Inserts).toHaveLength(1); // the original pre-populated record
  });
});

// ---------------------------------------------------------------------------
// getMigrationStatus
// ---------------------------------------------------------------------------
describe("getMigrationStatus", () => {
  it("returns correct applied/pending status", async () => {
    const client = new FakeDbClient();
    const m1 = {
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      sql: "select 1",
      checksum: checksumSql("select 1"),
    };
    const m2 = {
      version: 2,
      name: "second",
      filename: "0002_second.sql",
      sql: "select 2",
      checksum: checksumSql("select 2"),
    };

    client.appliedRecords.push({
      version: 1,
      name: "first",
      filename: "0001_first.sql",
      checksum: m1.checksum,
      applied_at: new Date().toISOString(),
    });

    const statuses = await getMigrationStatus(client, [m1, m2]);

    expect(statuses[0].applied).toBe(true);
    expect(statuses[0].record?.version).toBe(1);
    expect(statuses[1].applied).toBe(false);
    expect(statuses[1].record).toBeUndefined();
  });
});
