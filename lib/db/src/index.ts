import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// SSP dp-3 (data-in-transit encryption): `pg` does NOT read `sslmode` out of
// the connection string itself (a well-known gotcha — passing
// `?sslmode=require` in DATABASE_URL silently does nothing on its own), so
// TLS to Postgres has to be turned on explicitly here. Off by default (no
// behaviour change for the current deployment, which relies on GOV PaaS's
// private-network-only addon boundary rather than this) — set
// `DATABASE_SSL=require` once the Postgres add-on's certificate details are
// confirmed, to also encrypt this hop rather than just the browser<->
// api-server one that Northflank's edge TLS already covers.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { runStartupMigration } from "./startupMigration";
