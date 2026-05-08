import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { DbClient, DbQueryResult } from "./types.js";

class PooledConnection implements DbClient {
  constructor(private readonly pgClient: PoolClient) {}

  async query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<DbQueryResult<T>> {
    const result = await this.pgClient.query(sql, params);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    await this.pgClient.query("begin");
    try {
      const value = await fn(this);
      await this.pgClient.query("commit");
      return value;
    } catch (err) {
      await this.pgClient.query("rollback");
      throw err;
    }
  }
}

export class NodePgClient implements DbClient {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<DbQueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const pgClient = await this.pool.connect();
    try {
      const conn = new PooledConnection(pgClient);
      return await conn.transaction(fn);
    } finally {
      pgClient.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
