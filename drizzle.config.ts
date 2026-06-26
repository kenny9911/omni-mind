import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config (PostgreSQL). The app self-applies its schema at boot via
 * ensureSchema() (lib/server/db/client.ts), so this is here for `drizzle-kit generate`
 * when authoring future migrations against a compatible Postgres database.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
