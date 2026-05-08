import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NodePgClient } from "./client.js";
import { loadMigrations } from "./loader.js";
import { getMigrationStatus } from "./harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../migrations");

const EXPECTED_TABLES = [
  "users",
  "user_identities",
  "organizations",
  "organization_members",
  "organization_invites",
  "billing_accounts",
  "entitlements",
  "projects",
] as const;

async function runSmoke(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error(
      "Error: DATABASE_URL environment variable is not set.\n" +
        "Set it to your Postgres connection string before running the smoke."
    );
    process.exit(1);
  }

  // DATABASE_URL is intentionally not printed.
  console.log("Running V2 DB smoke checks...");

  const client = new NodePgClient(url);
  let failed = false;

  try {
    // Check 1: orun_schema_migrations contains 0001_core.sql
    const migrations = loadMigrations(migrationsDir);
    const statuses = await getMigrationStatus(client, migrations);
    const coreStatus = statuses.find(
      (s) => s.migration.filename === "0001_core.sql"
    );
    if (!coreStatus?.applied) {
      console.error("FAIL: 0001_core.sql is not recorded in orun_schema_migrations");
      failed = true;
    } else {
      console.log("PASS: orun_schema_migrations contains 0001_core.sql");
    }

    // Check 2: all 8 core tables exist
    for (const table of EXPECTED_TABLES) {
      const { rows } = await client.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS exists",
        [table]
      );
      if (!rows[0]?.exists) {
        console.error(`FAIL: table '${table}' does not exist`);
        failed = true;
      } else {
        console.log(`PASS: table '${table}' exists`);
      }
    }

    // Check 3: idx_projects_org index exists
    const { rows: idxRows } = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_org') AS exists"
    );
    if (!idxRows[0]?.exists) {
      console.error("FAIL: index 'idx_projects_org' does not exist");
      failed = true;
    } else {
      console.log("PASS: index 'idx_projects_org' exists");
    }

    // Check 4: lifecycle_status check constraint exists on organizations
    const { rows: chkRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM information_schema.check_constraints cc
       JOIN information_schema.constraint_table_usage ctu
         ON cc.constraint_name = ctu.constraint_name
         AND cc.constraint_schema = ctu.constraint_schema
       WHERE ctu.table_schema = 'public'
         AND ctu.table_name = 'organizations'
         AND cc.check_clause LIKE '%lifecycle_status%'`
    );
    if (parseInt(chkRows[0]?.count ?? "0", 10) === 0) {
      console.error(
        "FAIL: lifecycle_status check constraint on organizations not found"
      );
      failed = true;
    } else {
      console.log(
        "PASS: lifecycle_status check constraint on organizations exists"
      );
    }
  } finally {
    await client.end();
  }

  if (failed) {
    console.error("\nDB smoke: FAIL");
    process.exit(1);
  }
  console.log("\nDB smoke: PASS");
}

runSmoke().catch((err: unknown) => {
  console.error(
    "Smoke failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
