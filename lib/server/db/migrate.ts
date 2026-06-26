import { createDb, ensureSchema } from "./client";
import { seedSystemAccounts } from "./seed";

/** Standalone migration runner: `npm run db:migrate`. */
async function main() {
  const { db, client } = createDb();
  await ensureSchema(client);
  await seedSystemAccounts(db);
  // eslint-disable-next-line no-console
  console.log("[migrate] schema ensured + system accounts (demo, admin@robohire.io) at", process.env.DATABASE_URL || "file:./.data/omnimind.db");
  client.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed:", err);
  process.exit(1);
});
