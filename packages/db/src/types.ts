export interface Migration {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationRecord {
  version: number;
  name: string;
  filename: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationStatus {
  migration: Migration;
  applied: boolean;
  record?: MigrationRecord;
}

export interface DbQueryResult<T = unknown> {
  rows: T[];
}

export interface DbClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>>;
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}
