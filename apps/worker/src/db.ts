import postgres from "postgres";
import type { DbClient, DbQueryResult } from "@orun/db/runtime";

// postgres.js (porsager) works with Cloudflare Hyperdrive via the connectionString.
// Requires nodejs_compat flag in wrangler.jsonc.
// prepare: false is required because Hyperdrive does not support extended query protocol
// prepared statements across connection pool boundaries.

type SqlFn = {
  unsafe(query: string, values?: unknown[]): Promise<unknown[]> & { [Symbol.iterator](): Iterator<unknown> };
  begin<T>(fn: (tx: SqlFn) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

function wrapSql(sql: SqlFn): DbClient {
  return {
    async query<T>(sqlStr: string, params?: unknown[]): Promise<DbQueryResult<T>> {
      const rows = await sql.unsafe(sqlStr, params ?? []);
      return { rows: [...rows] as unknown as T[] };
    },
    async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return sql.begin((txSql) => fn(wrapSql(txSql as unknown as SqlFn)));
    },
  };
}

export function makeWorkerDbClient(connectionString: string): DbClient & { end(): Promise<void> } {
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    fetch_types: false,
  }) as unknown as SqlFn;

  const client = wrapSql(sql);
  return {
    ...client,
    async end() { await sql.end(); },
  };
}
