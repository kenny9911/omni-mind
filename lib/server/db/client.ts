import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";
import { DDL, ADDITIVE_MIGRATIONS } from "./ddl";

export type DB = NodePgDatabase<typeof schema>;
export interface DbBundle {
  db: DB;
  pool: Pool;
}

function resolveUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (expected a postgres:// connection string)");
  return url;
}

/**
 * Build an explicit pg PoolConfig from the connection string. We parse the URL ourselves
 * (rather than passing the raw string) so pooler-specific query params — pgbouncer,
 * connection_limit, pool_timeout — never reach the Postgres startup packet as unknown
 * settings. sslmode=disable → no TLS; any other sslmode → TLS (lenient verification).
 */
function poolConfig(connectionString: string): PoolConfig {
  const u = new URL(connectionString);
  const sslmode = u.searchParams.get("sslmode");
  const connLimit = Number(u.searchParams.get("connection_limit"));
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: false } : false,
    max: Number.isFinite(connLimit) && connLimit > 0 ? Math.min(connLimit, 20) : 10,
    application_name: "omnimind",
  };
}

/** Create a fresh DB bundle (used by the migrate script). */
export function createDb(url?: string): DbBundle {
  const pool = new Pool(poolConfig(url || resolveUrl()));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/**
 * Apply the idempotent schema + additive column migrations via a caller-supplied executor.
 * Shared by the prod pg Pool (ensureSchema) and the pglite test harness — both accept a
 * multi-statement SQL string. Safe to run repeatedly.
 */
export async function applySchema(exec: (sql: string) => Promise<unknown>): Promise<void> {
  await exec(DDL);
  for (const stmt of ADDITIVE_MIGRATIONS) {
    try {
      await exec(stmt);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      // ADD COLUMN / CREATE INDEX use IF NOT EXISTS, so "already exists" is expected — ignore.
      // Anything else is unexpected: log it but keep applying the remaining migrations.
      if (!/already exists/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.warn("[db] additive migration failed (continuing):", stmt, "—", msg);
      }
    }
  }
}

/** Apply the idempotent schema + additive column migrations. Safe to run repeatedly. */
export async function ensureSchema(pool: Pool): Promise<void> {
  await applySchema((sql) => pool.query(sql));
}

let ready: Promise<DbBundle> | null = null;

async function init(): Promise<DbBundle> {
  const bundle = createDb();
  await ensureSchema(bundle.pool); // schema is essential — a failure here must surface
  // System accounts are a convenience: seed them best-effort so a seeding hiccup never
  // takes down the API for real users.
  try {
    // Lazy import avoids a static import cycle (seed → client type-only).
    const { seedSystemAccounts } = await import("./seed");
    await seedSystemAccounts(bundle.db);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[db] seedSystemAccounts failed (non-fatal):", String((e as Error)?.message || e));
  }
  return bundle;
}

/**
 * Process-global, auto-migrating DB accessor used by route handlers. On failure the
 * memoized promise is cleared so the NEXT request retries init() instead of being stuck
 * with a permanently-rejected promise (which would 500 every request until a restart).
 */
export function getDb(): Promise<DbBundle> {
  if (!ready) {
    ready = init().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Test hook: drop the memoized instance. */
export function __resetDbForTests(): void {
  ready = null;
}

/**
 * Test hook: inject an already-prepared DB (e.g. an in-process pglite instance) as the
 * process-global. Subsequent getDb() calls return it without touching a real Postgres.
 */
export function __setDbForTests(db: DB): void {
  ready = Promise.resolve({ db, pool: undefined as unknown as Pool });
}

export { schema };
