import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "./types.js";

export function checksumSql(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function parseMigrationFilename(
  filename: string
): { version: number; name: string } | null {
  const match = filename.match(/^(\d+)_(.+)\.sql$/);
  if (!match) return null;
  return { version: parseInt(match[1], 10), name: match[2] };
}

export function loadMigrations(migrationsDir: string): Migration[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const migrations: Migration[] = [];
  const seenVersions = new Set<number>();

  for (const filename of files) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) throw new Error(`Invalid migration filename: ${filename}`);

    const { version, name } = parsed;
    if (seenVersions.has(version)) {
      throw new Error(
        `Duplicate migration version ${version}: ${filename}`
      );
    }
    seenVersions.add(version);

    const sql = readFileSync(join(migrationsDir, filename), "utf-8");
    const checksum = checksumSql(sql);

    migrations.push({ version, name, filename, sql, checksum });
  }

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].version <= migrations[i - 1].version) {
      throw new Error(
        `Non-monotonic migration versions: ${migrations[i - 1].filename} then ${migrations[i].filename}`
      );
    }
  }

  return migrations;
}
