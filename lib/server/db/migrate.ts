import { existsSync } from "node:fs";
import { createDb, ensureSchema } from "./client";
import { seedSystemAccounts } from "./seed";

// Next.js loads .env.local for the app; a standalone tsx run does not, so load it here
// (best-effort) before reading DATABASE_URL. process.loadEnvFile is available on Node 20.12+.
if (existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

/** Standalone migration runner: `npm run db:migrate`. */
async function main() {
  const { db, pool } = createDb();
  await ensureSchema(pool);
  await seedSystemAccounts(db);
  // eslint-disable-next-line no-console
  console.log("[migrate] schema ensured + system accounts (demo, admin@robohire.io) at", process.env.DATABASE_URL);
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed:", err);
  process.exit(1);
});
