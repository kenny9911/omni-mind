import { PRICE_MAP } from "./models";
import type { LedgerRecord } from "./types";

/** Rough token estimate from a string (≈ chars / 1.8). */
export function estTok(s: string): number {
  return Math.max(0, Math.round((s || "").length / 1.8));
}

/** Cost (¥) of a single call given in/out tokens and model id. */
export function respCost(inTok: number, outTok: number, id: string): number {
  const p = PRICE_MAP[id] || { in: 5, out: 15 };
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoney(n: number): string {
  if (n >= 1) return "¥" + n.toFixed(2);
  if (n >= 0.001 || n === 0) return "¥" + n.toFixed(4);
  return "¥" + n.toFixed(6);
}

export function fmtTime(d: Date): string {
  const z = (x: number) => (x < 10 ? "0" : "") + x;
  return (
    d.getMonth() + 1 + "/" + d.getDate() + " " + z(d.getHours()) + ":" + z(d.getMinutes())
  );
}

export interface Aggregate {
  tin: number;
  tout: number;
  mc: number;
  fee: number;
  total: number;
  calls: number;
  perArr: { id: string; calls: number; cost: number }[];
  days: { key: number; label: string; val: number }[];
  count: number;
}

export function aggregate(ledger: LedgerRecord[], PF: number): Aggregate {
  let tin = 0, tout = 0, mc = 0, fee = 0, calls = 0;
  const per: Record<string, { id: string; calls: number; cost: number }> = {};
  ledger.forEach((r) => {
    r.calls.forEach((cc) => {
      const cost = respCost(cc.inTok, cc.outTok, cc.id);
      tin += cc.inTok;
      tout += cc.outTok;
      mc += cost;
      calls++;
      if (!per[cc.id]) per[cc.id] = { id: cc.id, calls: 0, cost: 0 };
      per[cc.id].calls++;
      per[cc.id].cost += cost;
    });
    fee += PF * r.calls.length;
  });
  const perArr = Object.values(per).sort((a, b) => b.cost - a.cost);
  const days: Aggregate["days"] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push({ key: d.getTime(), label: d.getMonth() + 1 + "/" + d.getDate(), val: 0 });
  }
  ledger.forEach((r) => {
    const rd = new Date(r.ts);
    rd.setHours(0, 0, 0, 0);
    let c = 0;
    r.calls.forEach((cc) => (c += respCost(cc.inTok, cc.outTok, cc.id)));
    c += PF * r.calls.length;
    const dd = days.find((x) => x.key === rd.getTime());
    if (dd) dd.val += c;
  });
  return { tin, tout, mc, fee, total: mc + fee, calls, perArr, days, count: ledger.length };
}
