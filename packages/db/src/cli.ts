import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NodePgClient } from "./client.js";
import { loadMigrations } from "./loader.js";
import { applyMigrations, getMigrationStatus } from "./harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../migrations");

function requireDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error(
      "Error: DATABASE_URL environment variable is not set.\n" +
        "Set it to your Postgres connection string before running migrations."
    );
    process.exit(1);
  }
  return url;
}

async function cmdMigrate(): Promise<void> {
  const url = requireDatabaseUrl();
  const migrations = loadMigrations(migrationsDir);
  const client = new NodePgClient(url);
  try {
    await applyMigrations(client, migrations);
    const statuses = await getMigrationStatus(client, migrations);
    const applied = statuses.filter((s) => s.applied);
    console.log(`Migrations applied: ${applied.length}/${migrations.length}`);
  } finally {
    await client.end();
  }
}

async function cmdStatus(): Promise<void> {
  const url = requireDatabaseUrl();
  const migrations = loadMigrations(migrationsDir);
  const client = new NodePgClient(url);
  try {
    const statuses = await getMigrationStatus(client, migrations);
    for (const s of statuses) {
      const tag = s.applied ? "[applied]" : "[pending]";
      console.log(`${tag} ${s.migration.filename}`);
    }
  } finally {
    await client.end();
  }
}

async function cmdCheck(): Promise<void> {
  const url = requireDatabaseUrl();
  const migrations = loadMigrations(migrationsDir);
  const client = new NodePgClient(url);
  try {
    const statuses = await getMigrationStatus(client, migrations);
    let mismatch = false;
    for (const s of statuses) {
      if (s.applied && s.record && s.record.checksum !== s.migration.checksum) {
        console.error(
          `Checksum mismatch: ${s.migration.filename} ` +
            `(recorded ${s.record.checksum}, current ${s.migration.checksum})`
        );
        mismatch = true;
      }
    }
    if (mismatch) process.exit(1);
    console.log("All applied migration checksums verified.");
  } finally {
    await client.end();
  }
}

const command = process.argv[2];

switch (command) {
  case "migrate":
    cmdMigrate().catch((err: unknown) => {
      console.error("Migration failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
    break;
  case "status":
    cmdStatus().catch((err: unknown) => {
      console.error("Status failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
    break;
  case "check":
    cmdCheck().catch((err: unknown) => {
      console.error("Check failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
    break;
  default:
    console.error(`Unknown command: ${command ?? "(none)"}`);
    console.error("Usage: migrate | status | check");
    process.exit(1);
}
