import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { applySchema, __setDbForTests, __resetDbForTests, getDb, type DB } from "@/lib/server/db/client";
import * as schema from "@/lib/server/db/schema";
import { seedSystemAccounts } from "@/lib/server/db/seed";

async function columns(pg: PGlite, table: string): Promise<string[]> {
  const r = await pg.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

describe("DB resilience: schema drift + init retry (Postgres/pglite)", () => {
  it("migrates an OLD-schema DB in place (adds is_demo/status/oauth + turns columns) and seeds system accounts", async () => {
    const pg = new PGlite();
    // Build a pre-migration schema: users WITHOUT is_demo/status/oauth, turns WITHOUT
    // main_model/trio_json/auto — exactly the columns ADDITIVE_MIGRATIONS must backfill.
    await pg.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL DEFAULT '',
        plan_id TEXT NOT NULL DEFAULT 'free', role TEXT NOT NULL DEFAULT 'user',
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
      CREATE UNIQUE INDEX ux_users_email ON users (email);
      CREATE TABLE turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
        mode TEXT NOT NULL, prompt_text TEXT NOT NULL, route_text TEXT,
        deep_research BOOLEAN NOT NULL DEFAULT FALSE, deep_agents BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'streaming', created_at BIGINT NOT NULL);
    `);

    // The server's exact schema-apply path must succeed against the old DB and backfill columns.
    await applySchema((sql) => pg.exec(sql));

    const ucols = await columns(pg, "users");
    expect(ucols).toEqual(expect.arrayContaining(["is_demo", "status", "oauth_provider", "google_sub", "avatar_url"]));
    const tcols = await columns(pg, "turns");
    expect(tcols).toEqual(expect.arrayContaining(["main_model", "trio_json", "auto"]));

    const db = drizzle(pg, { schema }) as unknown as DB;
    await seedSystemAccounts(db);
    const emails = (await pg.query<{ email: string }>("SELECT email FROM users")).rows.map((r) => r.email);
    expect(emails).toContain("demo");
    expect(emails).toContain("admin@robohire.io");
  });

  it("getDb() retries init after a failure instead of caching the rejection (self-heals)", async () => {
    const ORIG = process.env.DATABASE_URL;
    __resetDbForTests();
    // No DATABASE_URL → createDb() throws → init() rejects. The rejection must NOT be cached.
    delete process.env.DATABASE_URL;
    await expect(getDb()).rejects.toBeTruthy();

    // A subsequent successful setup must resolve (proves the prior rejection was cleared).
    const pg = new PGlite();
    await applySchema((sql) => pg.exec(sql));
    __setDbForTests(drizzle(pg, { schema }) as unknown as DB);
    const { db } = await getDb();
    expect(db).toBeTruthy();

    if (ORIG !== undefined) process.env.DATABASE_URL = ORIG;
    __resetDbForTests();
  });

  it("applySchema is idempotent — repeated apply + seed stays clean", async () => {
    const pg = new PGlite();
    await applySchema((sql) => pg.exec(sql));
    await applySchema((sql) => pg.exec(sql)); // re-run: must not throw or duplicate
    const db = drizzle(pg, { schema }) as unknown as DB;
    await seedSystemAccounts(db);
    await seedSystemAccounts(db); // idempotent seed
    const n = (await pg.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE email='demo'")).rows[0].n;
    expect(Number(n)).toBe(1);
  });
});
