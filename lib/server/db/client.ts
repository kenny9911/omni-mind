import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";
import { DDL, ADDITIVE_MIGRATIONS } from "./ddl";

export type DB = ReturnType<typeof drizzle<typeof schema>>;
export interface DbBundle {
  db: DB;
  client: Client;
}

function resolveUrl(): string {
  return process.env.DATABASE_URL || "file:./.data/omnimind.db";
}

function ensureFileDir(url: string) {
  if (url.startsWith("file:")) {
    const path = url.slice("file:".length);
    const dir = dirname(path);
    if (dir && dir !== "." && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** Create a fresh DB bundle (used by tests for isolation). */
export function createDb(url?: string): DbBundle {
  const dbUrl = url || resolveUrl();
  ensureFileDir(dbUrl);
  const client = createClient({
    url: dbUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Apply the idempotent schema + additive column migrations. Safe to run repeatedly. */
export async function ensureSchema(client: Client): Promise<void> {
  await client.executeMultiple(DDL);
  for (const stmt of ADDITIVE_MIGRATIONS) {
    try {
      await client.execute(stmt);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      // A duplicate column means an already-migrated DB — expected, ignore. Anything
      // else is unexpected: log it but keep applying the remaining migrations.
      if (!/duplicate column/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.warn("[db] additive migration failed (continuing):", stmt, "—", msg);
      }
    }
  }
}

let ready: Promise<DbBundle> | null = null;

async function init(): Promise<DbBundle> {
  const bundle = createDb();
  await ensureSchema(bundle.client); // schema is essential — a failure here must surface
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

/** Test hook: drop the memoized instance so a new DATABASE_URL takes effect. */
export function __resetDbForTests(): void {
  ready = null;
}

export { schema };
