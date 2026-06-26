import { randomBytes, randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { sessions, users, type User } from "../db/schema";

export const COOKIE_NAME = "omni_session";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CreatedSession {
  id: string;
  cookie: string;
}

export async function createSession(
  db: DB,
  userId: string,
  remember = false,
  userAgent?: string | null,
): Promise<CreatedSession> {
  const id = randomBytes(32).toString("hex");
  const ttl = remember ? REMEMBER_TTL_MS : DEFAULT_TTL_MS;
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: now + ttl,
    createdAt: now,
    userAgent: userAgent ?? null,
  });
  return { id, cookie: buildCookie(id, Math.floor(ttl / 1000)) };
}

export function buildCookie(value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`;
}

export function clearCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) return v.join("=");
  }
  return null;
}

/** Resolve the current user from the session cookie; lazily GCs expired sessions. */
export async function resolveSession(db: DB, req: Request): Promise<User | null> {
  const token = readCookie(req);
  if (!token) return null;
  const rows = await db.select().from(sessions).where(eq(sessions.id, token)).limit(1);
  const sess = rows[0];
  if (!sess) return null;
  if (sess.expiresAt < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, token));
    return null;
  }
  const u = await db.select().from(users).where(eq(users.id, sess.userId)).limit(1);
  return u[0] ?? null;
}

export async function destroySession(db: DB, req: Request): Promise<void> {
  const token = readCookie(req);
  if (token) await db.delete(sessions).where(eq(sessions.id, token));
}

/** Opportunistic sweep of expired sessions (called occasionally). */
export async function sweepExpiredSessions(db: DB): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
}

export { randomUUID };
