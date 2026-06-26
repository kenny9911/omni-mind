import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, __resetDbForTests } from "@/lib/server/db/client";

const ORIG = process.env.DATABASE_URL;
const ORIG_LLM = process.env.LLM_MODE;

afterAll(() => {
  process.env.DATABASE_URL = ORIG;
  process.env.LLM_MODE = ORIG_LLM;
  __resetDbForTests();
});

function tempUrl(prefix: string): string {
  return "file:" + join(mkdtempSync(join(tmpdir(), prefix)), "db.sqlite");
}

describe("DB resilience: schema drift + init retry", () => {
  it("migrates an OLD-schema DB in place (adds is_demo + turns columns) and seeds system accounts", async () => {
    const url = tempUrl("omni-old-");
    // Build a pre-migration schema: users WITHOUT is_demo, turns WITHOUT main_model/trio_json/auto.
    const raw = createClient({ url });
    await raw.executeMultiple(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL DEFAULT '',
        plan_id TEXT NOT NULL DEFAULT 'pro', role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
        mode TEXT NOT NULL, prompt_text TEXT NOT NULL, route_text TEXT,
        deep_research INTEGER NOT NULL DEFAULT 0, deep_agents INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'streaming', created_at INTEGER NOT NULL);
    `);
    raw.close();

    process.env.DATABASE_URL = url;
    __resetDbForTests();

    // The server's exact init path must succeed against the old DB (this is the bug the
    // user hit: a stale init failed on a missing is_demo column).
    const { client } = await getDb();

    const ucols = (await client.execute("PRAGMA table_info(users)")).rows.map((r) => r.name);
    expect(ucols).toContain("is_demo");
    const tcols = (await client.execute("PRAGMA table_info(turns)")).rows.map((r) => r.name);
    expect(tcols).toEqual(expect.arrayContaining(["main_model", "trio_json", "auto"]));

    const emails = (await client.execute("SELECT email FROM users")).rows.map((r) => r.email);
    expect(emails).toContain("demo");
    expect(emails).toContain("admin@robohire.io");
  });

  it("getDb() retries init after a failure instead of caching the rejection (self-heals)", async () => {
    __resetDbForTests();
    // Point at a path whose parent is a FILE → directory creation fails → init rejects.
    process.env.DATABASE_URL = "file:/etc/hosts/cannot-create.db";
    await expect(getDb()).rejects.toBeTruthy();

    // A subsequent call with a valid URL must retry and succeed (rejection not cached).
    process.env.DATABASE_URL = tempUrl("omni-retry-");
    const { db } = await getDb();
    expect(db).toBeTruthy();
  });

  it("ensureSchema is idempotent — repeated init on the same DB stays clean", async () => {
    process.env.DATABASE_URL = tempUrl("omni-idem-");
    __resetDbForTests();
    const a = await getDb();
    // re-run the migration directly; must not throw or duplicate the system accounts
    const { ensureSchema } = await import("@/lib/server/db/client");
    await ensureSchema(a.client);
    const { seedSystemAccounts } = await import("@/lib/server/db/seed");
    await seedSystemAccounts(a.db);
    const demoCount = (await a.client.execute("SELECT COUNT(*) n FROM users WHERE email='demo'")).rows[0].n;
    expect(Number(demoCount)).toBe(1);
  });
});
