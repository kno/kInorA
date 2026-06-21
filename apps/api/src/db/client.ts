import { Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

/**
 * Create a PostgreSQL connection pool and Drizzle client.
 *
 * Accepts optional PoolConfig overrides so tests can supply
 * connection parameters without touching environment variables.
 */
export function createDbClient(
  config?: Partial<PoolConfig>
): { db: Database; pool: Pool } {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ...config,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}