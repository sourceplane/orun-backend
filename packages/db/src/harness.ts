import type { DbClient, Migration, MigrationRecord, MigrationStatus } from "./types.js";

const CREATE_MIGRATIONS_TABLE = `
  create table if not exists orun_schema_migrations (
    version    integer     not null,
    name       text        not null,
    filename   text        not null unique,
    checksum   text        not null,
    applied_at timestamptz not null default now(),
    primary key (version)
  )
`;

const SELECT_APPLIED = `
  select version, name, filename, checksum, applied_at
  from orun_schema_migrations
  order by version
`;

const INSERT_APPLIED = `
  insert into orun_schema_migrations (version, name, filename, checksum)
  values ($1, $2, $3, $4)
`;

export async function applyMigrations(
  client: DbClient,
  migrations: Migration[]
): Promise<void> {
  await client.query(CREATE_MIGRATIONS_TABLE);

  const { rows: applied } =
    await client.query<MigrationRecord>(SELECT_APPLIED);

  for (const record of applied) {
    const migration = migrations.find((m) => m.version === record.version);
    if (migration && migration.checksum !== record.checksum) {
      throw new Error(
        `Checksum mismatch for migration ${record.filename}: ` +
          `recorded ${record.checksum}, current ${migration.checksum}`
      );
    }
  }

  const appliedVersions = new Set(applied.map((r) => r.version));
  const pending = migrations.filter((m) => !appliedVersions.has(m.version));

  for (const migration of pending) {
    await client.transaction(async (tx) => {
      await tx.query(migration.sql);
      await tx.query(INSERT_APPLIED, [
        migration.version,
        migration.name,
        migration.filename,
        migration.checksum,
      ]);
    });
  }
}

export async function getMigrationStatus(
  client: DbClient,
  migrations: Migration[]
): Promise<MigrationStatus[]> {
  await client.query(CREATE_MIGRATIONS_TABLE);

  const { rows: applied } =
    await client.query<MigrationRecord>(SELECT_APPLIED);

  const appliedByVersion = new Map(applied.map((r) => [r.version, r]));

  return migrations.map((migration) => {
    const record = appliedByVersion.get(migration.version);
    return { migration, applied: record !== undefined, record };
  });
}
