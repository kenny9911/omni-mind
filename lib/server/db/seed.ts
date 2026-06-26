import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MODELS } from "@/lib/models";
import type { Lang } from "@/lib/types";
import type { DB } from "./client";
import { users, preferences, modelState, subscriptions } from "./schema";
import { includedCreditFor, type PlanId } from "../billing/plans";
import { hashPassword } from "../auth/password";
import { currentMonthRange } from "../util";

/**
 * Signup side effects: preferences (FR-40 defaults), 12 enabled model_state rows, and
 * an active subscription. No invoices, payment method, or usage are seeded — every
 * account starts genuinely clean (real data accrues from real activity).
 */
export async function seedNewUser(
  db: DB,
  userId: string,
  opts: { lang?: Lang; planId?: PlanId } = {},
): Promise<void> {
  const now = Date.now();
  const lang = opts.lang ?? "zh";
  const planId = opts.planId ?? "free";

  await db.insert(preferences).values({
    userId,
    theme: "dark",
    lang,
    mode: "expert",
    auto: true,
    mainModel: "gpt-55",
    trioJson: JSON.stringify(["deepseek-pro", "gpt-55", "claude-opus"]),
    deepResearch: false,
    deepAgents: false,
    platformFeeDisplayMicro: 50000,
    updatedAt: now,
  });

  await db.insert(modelState).values(
    MODELS.map((m) => ({ userId, modelId: m.id, enabled: true, updatedAt: now })),
  );

  const { start, end } = currentMonthRange(now);
  await db.insert(subscriptions).values({
    userId,
    planId,
    includedCreditMicro: includedCreditFor(planId),
    creditBalanceMicro: 0,
    status: "active",
    periodStart: start,
    periodEnd: end,
    updatedAt: now,
  });
  // No seeded invoices, payment method, or usage history — every account starts
  // genuinely clean. Invoices appear only when the user actually pays; a card
  // appears only when the user adds one; usage accrues only from real turns.
}

/**
 * Idempotently create the two fixed system accounts (both real, clean — no seeded
 * data). `isDemo` only marks demo/demo123 as a shared showcase login: its profile is
 * read-only (so the shared password can't be changed) and it can't be deleted by an
 * admin. It uses real models like any account. Safe to call on every boot.
 */
export async function seedSystemAccounts(db: DB): Promise<void> {
  await ensureSystemUser(db, {
    email: "demo",
    name: "Demo User",
    password: "demo123",
    role: "user",
    isDemo: true,
    lang: "zh",
  });
  await ensureSystemUser(db, {
    email: "admin@robohire.io",
    name: "Admin",
    password: "Lightark@1",
    role: "admin",
    isDemo: false,
    lang: "en",
  });
}

async function ensureSystemUser(
  db: DB,
  o: { email: string; name: string; password: string; role: string; isDemo: boolean; lang: Lang },
): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, o.email)).limit(1);
  if (existing[0]) return;
  const id = randomUUID();
  const now = Date.now();
  const { hash, salt } = hashPassword(o.password);
  await db.insert(users).values({
    id,
    email: o.email,
    name: o.name,
    passwordHash: hash,
    salt,
    planId: "free",
    role: o.role,
    isDemo: o.isDemo,
    createdAt: now,
    updatedAt: now,
  });
  await seedNewUser(db, id, { lang: o.lang });
}
