import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 25,                    // max concurrent DB connections
  idleTimeoutMillis: 30000,   // close idle connection after 30s
  connectionTimeoutMillis: 3000, // fail fast if no free connection in 3s
});
export const db = drizzle(pool, { schema });

export * from "./schema";

// Re-export drizzle helpers so consumers use the same version as the db package
export { sql, eq, and, or, gt, lt, gte, lte, ne, isNull, isNotNull, inArray, notInArray, desc, asc, count, countDistinct, sum, avg, max, min } from "drizzle-orm";
