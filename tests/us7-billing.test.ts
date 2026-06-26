import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, req, invoke } from "./helpers/harness";

import { POST as signup } from "@/app/api/auth/signup/route";
import {
  GET as getSubscription,
  POST as changePlan,
} from "@/app/api/billing/subscription/route";
import { GET as getPlans } from "@/app/api/billing/plans/route";
import { GET as listInvoices } from "@/app/api/billing/invoices/route";
import { GET as getInvoice } from "@/app/api/billing/invoices/[id]/route";
import { POST as topup } from "@/app/api/billing/topup/route";
import {
  GET as getPaymentMethod,
  PUT as putPaymentMethod,
} from "@/app/api/billing/payment-method/route";

// Plan/credit constants from lib/server/billing/plans.ts (micro-CNY).
const PRO_CREDIT = 150_000_000;
const TEAM_CREDIT = 750_000_000;
const PRO_INVOICE_MICRO = 199_000_000;
const TOPUP_MIN = 1_000_000; // ¥1
const TOPUP_MAX = 1_000_000_000; // ¥1000

/** Sign up a fresh user (defaults to Free) and return their session cookie. */
async function signupUser(email: string): Promise<string> {
  const r = await invoke(
    signup,
    req("POST", "/api/auth/signup", {
      body: { name: "Billing User", email, password: "supersecret" },
    }),
  );
  expect(r.status).toBe(200);
  expect(r.body.data.plan).toBe("free"); // new accounts start Free
  return r.cookie!;
}

/** A Free user upgraded to Pro — for exercising the Pro credit-math paths below. */
async function proUser(email: string): Promise<string> {
  const c = await signupUser(email);
  const up = await invoke(changePlan, req("POST", "/api/billing/subscription", { cookie: c, body: { planId: "pro" } }));
  expect(up.status).toBe(200);
  return c;
}

let cookie: string;

beforeAll(async () => {
  await setupTestDb();
  cookie = await proUser("primary@omnimind.dev"); // Pro, to exercise the credit-math paths
  expect(cookie).toBeTruthy();
});

describe("US7.UC1: new accounts default to Free (0 credit)", () => {
  it("a fresh account is Free with 0 included credit and usedPct=0 (no divide-by-zero)", async () => {
    const free = await signupUser("free-default@omnimind.dev");
    const r = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie: free }));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.plan.id).toBe("free");
    expect(d.includedCreditMicro).toBe(0);
    expect(d.usedPct).toBe(0);
    expect(d.remainingMicro).toBe(0);
  });
});

describe("US7.UC1: Get current subscription + credit usage", () => {
  it("returns a Pro subscription with ¥150 included credit and the documented shape", async () => {
    const r = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const d = r.body.data;
    expect(d.plan.id).toBe("pro");
    expect(d.plan.name).toBe("Pro");
    expect(d.plan.includedCreditMicro).toBe(PRO_CREDIT);
    expect(d.includedCreditMicro).toBe(PRO_CREDIT);
    // renewsOn mirrors the period end (US7.UC1 contract).
    expect(d.plan.renewsOn).toBe(d.plan.periodEnd);
    expect(d.plan.periodEnd).toBeGreaterThan(d.plan.periodStart);
    // usage panel is present with the three documented fields.
    expect(typeof d.usage.modelCostMicro).toBe("number");
    expect(typeof d.usage.platformFeeMicro).toBe("number");
    expect(typeof d.usage.monthTotalMicro).toBe("number");
  });

  it("computes remaining + usedPct as exact invariants over month-to-date spend", async () => {
    const r = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    expect(r.status).toBe(200);
    const d = r.body.data;
    // monthTotal = model cost + platform fee (zero drift over micro-CNY).
    expect(d.usage.monthTotalMicro).toBe(d.usage.modelCostMicro + d.usage.platformFeeMicro);
    // remainingMicro = max(0, included − monthTotal).
    expect(d.remainingMicro).toBe(Math.max(0, PRO_CREDIT - d.usage.monthTotalMicro));
    // usedPct = min(100, round(monthTotal/included*100)), clamped to [0,100].
    const expectedPct = Math.min(100, Math.round((d.usage.monthTotalMicro / PRO_CREDIT) * 100));
    expect(d.usedPct).toBe(expectedPct);
    expect(d.usedPct).toBeGreaterThanOrEqual(0);
    expect(d.usedPct).toBeLessThanOrEqual(100);
  });

  it("rejects unauthenticated access with 401 AUTH_REQUIRED", async () => {
    const r = await invoke(getSubscription, req("GET", "/api/billing/subscription"));
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("AUTH_REQUIRED");
  });
});

describe("US7.UC2: List plans (Free/Pro/Team/Enterprise)", () => {
  it("returns exactly 4 plans with the Pro plan flagged current", async () => {
    const r = await invoke(getPlans, req("GET", "/api/billing/plans", { cookie }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const plans = r.body.data.plans;
    expect(plans).toHaveLength(4);
    expect(plans.map((p: any) => p.id)).toEqual(["free", "pro", "team", "ent"]);
    const current = plans.filter((p: any) => p.current);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe("pro");
  });

  it("flags Enterprise as custom-priced (priceMicro:null) and Pro at ¥150 credit", async () => {
    const r = await invoke(getPlans, req("GET", "/api/billing/plans", { cookie }));
    const plans = r.body.data.plans;
    const ent = plans.find((p: any) => p.id === "ent");
    const pro = plans.find((p: any) => p.id === "pro");
    expect(ent.priceMicro).toBeNull();
    expect(ent.includedCreditMicro).toBeNull();
    expect(pro.includedCreditMicro).toBe(PRO_CREDIT);
    expect(pro.priceMicro).toBe(PRO_INVOICE_MICRO);
  });

  it("resolves localized features via the lang query (default zh, en override)", async () => {
    const zh = await invoke(getPlans, req("GET", "/api/billing/plans", { cookie }));
    const zhPro = zh.body.data.plans.find((p: any) => p.id === "pro");
    expect(Array.isArray(zhPro.features)).toBe(true);
    expect(zhPro.features.length).toBeGreaterThan(0);
    // default lang is zh → first feature is the Chinese credit bullet.
    expect(zhPro.features[0]).toContain("¥150");
    expect(zhPro.features.some((f: string) => /[一-鿿]/.test(f))).toBe(true);

    const en = await invoke(getPlans, req("GET", "/api/billing/plans?lang=en", { cookie }));
    const enPro = en.body.data.plans.find((p: any) => p.id === "pro");
    expect(enPro.features).toContain("¥150 model credit");
  });
});

describe("US7.UC3: Change / subscribe to a plan", () => {
  it("rejects the Enterprise plan with 409 PLAN_REQUIRES_SALES and no plan change", async () => {
    const ent = await invoke(
      changePlan,
      req("POST", "/api/billing/subscription", { cookie, body: { planId: "ent" } }),
    );
    expect(ent.status).toBe(409);
    expect(ent.body.ok).toBe(false);
    expect(ent.body.error.code).toBe("PLAN_REQUIRES_SALES");
    // plan unchanged: still Pro.
    const after = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    expect(after.body.data.plan.id).toBe("pro");
  });

  it("rejects an unknown plan id with 400 VALIDATION_ERROR", async () => {
    const r = await invoke(
      changePlan,
      req("POST", "/api/billing/subscription", { cookie, body: { planId: "platinum" } }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("switches to Team and updates included credit, reflected on the next GET", async () => {
    // Use a dedicated user so the primary account stays Pro for other suites.
    const teamCookie = await signupUser("team@omnimind.dev");
    const r = await invoke(
      changePlan,
      req("POST", "/api/billing/subscription", { cookie: teamCookie, body: { planId: "team" } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.data.plan.id).toBe("team");
    expect(r.body.data.plan.includedCreditMicro).toBe(TEAM_CREDIT);
    expect(r.body.data.includedCreditMicro).toBe(TEAM_CREDIT);

    const after = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie: teamCookie }));
    expect(after.body.data.plan.id).toBe("team");
    expect(after.body.data.includedCreditMicro).toBe(TEAM_CREDIT);
    // The plans list now flags Team as current for this user.
    const plans = await invoke(getPlans, req("GET", "/api/billing/plans", { cookie: teamCookie }));
    expect(plans.body.data.plans.find((p: any) => p.current).id).toBe("team");
  });
});

describe("US7.UC4: List & download invoices", () => {
  it("a fresh account has no invoices; real top-ups create paid invoices, newest-first", async () => {
    const u = await signupUser("inv-fresh@omnimind.dev");
    const empty = await invoke(listInvoices, req("GET", "/api/billing/invoices", { cookie: u }));
    expect(empty.status).toBe(200);
    expect(empty.body.data.invoices).toEqual([]); // clean account — nothing seeded

    await invoke(topup, req("POST", "/api/billing/topup", { cookie: u, body: { amountMicro: TOPUP_MIN } }));
    await invoke(topup, req("POST", "/api/billing/topup", { cookie: u, body: { amountMicro: TOPUP_MIN } }));
    const r = await invoke(listInvoices, req("GET", "/api/billing/invoices", { cookie: u }));
    const invoices = r.body.data.invoices;
    expect(invoices.length).toBe(2);
    for (let i = 1; i < invoices.length; i++) {
      expect(invoices[i - 1].date).toBeGreaterThanOrEqual(invoices[i].date); // newest-first
    }
    for (const iv of invoices) {
      expect(iv.kind).toBe("topup");
      expect(iv.status).toBe("paid");
    }
  });

  it("returns a single owned invoice with line items via /invoices/:id", async () => {
    const u = await signupUser("inv-one@omnimind.dev");
    const t = await invoke(topup, req("POST", "/api/billing/topup", { cookie: u, body: { amountMicro: TOPUP_MIN } }));
    const id = t.body.data.invoice.id;
    const r = await invoke(getInvoice, req("GET", `/api/billing/invoices/${id}`, { cookie: u }), { id });
    expect(r.status).toBe(200);
    expect(r.body.data.invoice.id).toBe(id);
    expect(r.body.data.invoice.amountMicro).toBe(TOPUP_MIN);
    expect(Array.isArray(r.body.data.invoice.lineItems)).toBe(true);
    expect(r.body.data.invoice.lineItems.length).toBeGreaterThan(0);
    const sum = r.body.data.invoice.lineItems.reduce((a: number, li: any) => a + li.amountMicro, 0);
    expect(sum).toBe(r.body.data.invoice.amountMicro);
  });

  it("returns 404 NOT_FOUND for an invoice owned by another user", async () => {
    const owner = await signupUser("inv-owner@omnimind.dev");
    const t = await invoke(topup, req("POST", "/api/billing/topup", { cookie: owner, body: { amountMicro: TOPUP_MIN } }));
    const otherInvoiceId = t.body.data.invoice.id;
    // primary user tries to read the other user's invoice.
    const r = await invoke(
      getInvoice,
      req("GET", `/api/billing/invoices/${otherInvoiceId}`, { cookie }),
      { id: otherInvoiceId },
    );
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });
});

describe("US7.UC5: Top up credit & manage payment method", () => {
  it("tops up ¥100 → increases creditBalanceMicro and creates a paid topup invoice", async () => {
    const before = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    const beforeBalance = before.body.data.creditBalanceMicro;

    const amountMicro = 100_000_000; // ¥100
    const r = await invoke(topup, req("POST", "/api/billing/topup", { cookie, body: { amountMicro } }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.creditBalanceMicro).toBe(beforeBalance + amountMicro);
    expect(r.body.data.invoice.kind).toBe("topup");
    expect(r.body.data.invoice.status).toBe("paid");
    expect(r.body.data.invoice.amountMicro).toBe(amountMicro);

    // balance change persists on the subscription read.
    const after = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    expect(after.body.data.creditBalanceMicro).toBe(beforeBalance + amountMicro);

    // a topup invoice now appears in the invoice list.
    const invoices = await invoke(listInvoices, req("GET", "/api/billing/invoices", { cookie }));
    const topups = invoices.body.data.invoices.filter((iv: any) => iv.kind === "topup");
    expect(topups.some((iv: any) => iv.id === r.body.data.invoice.id)).toBe(true);
  });

  it("rejects an out-of-bounds top-up amount with 400 and leaves the balance unchanged", async () => {
    const before = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    const beforeBalance = before.body.data.creditBalanceMicro;

    // amount 0 is below the ¥1 minimum.
    const zero = await invoke(topup, req("POST", "/api/billing/topup", { cookie, body: { amountMicro: 0 } }));
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe("VALIDATION_ERROR");

    // amount above the ¥1000 cap.
    const tooBig = await invoke(
      topup,
      req("POST", "/api/billing/topup", { cookie, body: { amountMicro: TOPUP_MAX + 1 } }),
    );
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe("VALIDATION_ERROR");

    const after = await invoke(getSubscription, req("GET", "/api/billing/subscription", { cookie }));
    expect(after.body.data.creditBalanceMicro).toBe(beforeBalance);
  });

  it("accepts the minimum/maximum bound amounts (¥1 and ¥1000)", async () => {
    const minR = await invoke(topup, req("POST", "/api/billing/topup", { cookie, body: { amountMicro: TOPUP_MIN } }));
    expect(minR.status).toBe(200);
    expect(minR.body.data.invoice.amountMicro).toBe(TOPUP_MIN);
    const maxR = await invoke(topup, req("POST", "/api/billing/topup", { cookie, body: { amountMicro: TOPUP_MAX } }));
    expect(maxR.status).toBe(200);
    expect(maxR.body.data.invoice.amountMicro).toBe(TOPUP_MAX);
  });

  it("payment-method is null on a fresh account, then GET returns the masked fields after adding one", async () => {
    const u = await signupUser("pm-fresh@omnimind.dev");
    const fresh = await invoke(getPaymentMethod, req("GET", "/api/billing/payment-method", { cookie: u }));
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.method).toBeNull(); // clean account — no seeded card

    await invoke(
      putPaymentMethod,
      req("PUT", "/api/billing/payment-method", { cookie: u, body: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 } }),
    );
    const r = await invoke(getPaymentMethod, req("GET", "/api/billing/payment-method", { cookie: u }));
    const m = r.body.data.method;
    expect(m).not.toBeNull();
    expect(m.brand).toBe("visa");
    expect(m.last4).toBe("4242");
    expect(m.expMonth).toBe(8);
    expect(m.expYear).toBe(2028);
    // never expose a full PAN.
    expect(m.last4.length).toBe(4);
    expect(Object.keys(m)).not.toContain("number");
    expect(Object.keys(m)).not.toContain("pan");
  });

  it("PUT payment-method persists a masked method and survives a follow-up GET", async () => {
    const put = await invoke(
      putPaymentMethod,
      req("PUT", "/api/billing/payment-method", {
        cookie,
        body: { brand: "mastercard", last4: "5454", expMonth: 12, expYear: 2030 },
      }),
    );
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);
    expect(put.body.data.method.brand).toBe("mastercard");
    expect(put.body.data.method.last4).toBe("5454");
    // PUT returns the masked display string (US7.UC5 masking requirement).
    expect(put.body.data.method.masked).toBe("•••• 5454");

    const get = await invoke(getPaymentMethod, req("GET", "/api/billing/payment-method", { cookie }));
    expect(get.body.data.method.brand).toBe("mastercard");
    expect(get.body.data.method.last4).toBe("5454");
    expect(get.body.data.method.expMonth).toBe(12);
    expect(get.body.data.method.expYear).toBe(2030);
  });

  it("rejects a payment method with a past expiry (400 VALIDATION_ERROR)", async () => {
    const r = await invoke(
      putPaymentMethod,
      req("PUT", "/api/billing/payment-method", {
        cookie,
        body: { brand: "visa", last4: "1111", expMonth: 1, expYear: 2000 },
      }),
    );
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });
});
