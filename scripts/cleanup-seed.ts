/**
 * One-time, idempotent cleanup of fake data seeded into accounts that were created
 * BEFORE mock/seed removal. Safe to run repeatedly; only removes the exact seed
 * signatures (never real data — real invoices are kind='topup', real cards are
 * user-added, real usage comes from real turns).
 *
 *   DATABASE_URL=... npm run cleanup:seed
 *
 * Loads .env.local automatically; defaults to the local .data DB.
 */
import fs from "node:fs";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/lib/server/db/client";
import {
  users,
  invoices,
  paymentMethods,
  conversations,
  turns,
  messages,
  usageRecords,
} from "@/lib/server/db/schema";

// Load .env.local so DATABASE_URL / auth token resolve like the app does.
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — use defaults */
}

// Titles the old seedUsageHistory created for the demo account.
const SEED_TITLES = ["分布式限流算法设计", "关西 5 日深度行程", "商务合作邀请邮件"];

async function main(): Promise<void> {
  const { db } = await getDb();

  // 1. Seeded subscription invoices (the 3× ¥199 "paid" rows). kind='subscription' is
  //    seed-only today — real invoices are always kind='topup'.
  const seededInvoices = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.kind, "subscription"));
  if (seededInvoices.length) await db.delete(invoices).where(eq(invoices.kind, "subscription"));
  console.log(`✓ removed ${seededInvoices.length} seeded subscription invoices`);

  // 2. The seeded "visa •••• 4242" card (exact signature).
  const cardWhere = and(
    eq(paymentMethods.brand, "visa"),
    eq(paymentMethods.last4, "4242"),
    eq(paymentMethods.expMonth, 8),
    eq(paymentMethods.expYear, 2028),
  );
  const seededCards = await db.select({ userId: paymentMethods.userId }).from(paymentMethods).where(cardWhere);
  if (seededCards.length) await db.delete(paymentMethods).where(cardWhere);
  console.log(`✓ removed ${seededCards.length} seeded payment methods (visa 4242)`);

  // 3. The demo account's seeded conversations + their usage (by the known titles).
  const demoUsers = await db.select({ id: users.id }).from(users).where(eq(users.isDemo, true));
  let convCount = 0;
  let usageCount = 0;
  for (const u of demoUsers) {
    const convs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.userId, u.id), inArray(conversations.title, SEED_TITLES)));
    if (!convs.length) continue;
    const convIds = convs.map((c) => c.id);
    const turnRows = await db.select({ id: turns.id }).from(turns).where(inArray(turns.conversationId, convIds));
    const turnIds = turnRows.map((t) => t.id);
    // usage_records have no FK (retained on conversation delete by design) — delete explicitly.
    if (turnIds.length) {
      const ur = await db.select({ id: usageRecords.id }).from(usageRecords).where(inArray(usageRecords.turnId, turnIds));
      if (ur.length) await db.delete(usageRecords).where(inArray(usageRecords.turnId, turnIds));
      usageCount += ur.length;
    }
    // explicit child-then-parent deletion (does not rely on the cascade pragma).
    await db.delete(messages).where(inArray(messages.conversationId, convIds));
    await db.delete(turns).where(inArray(turns.conversationId, convIds));
    await db.delete(conversations).where(inArray(conversations.id, convIds));
    convCount += convs.length;
  }
  console.log(`✓ removed ${convCount} seeded demo conversations + ${usageCount} seeded usage rows`);
  console.log("cleanup complete.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("cleanup failed:", e);
    process.exit(1);
  },
);
