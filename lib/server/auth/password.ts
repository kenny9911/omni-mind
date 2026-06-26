import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt password hashing with a per-user salt (docs/technical-design.md §4.1). */
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(pw: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, KEYLEN, PARAMS).toString("hex");
  return { hash, salt };
}

export function verifyPassword(pw: string, hash: string, salt: string): boolean {
  if (!hash || !salt) return false;
  const cand = scryptSync(pw, salt, KEYLEN, PARAMS);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== cand.length) return false;
  return timingSafeEqual(cand, expected);
}
