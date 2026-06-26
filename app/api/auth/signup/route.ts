import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { route, json, ApiError, parseBody } from "@/lib/server/http";
import { hashPassword } from "@/lib/server/auth/password";
import { createSession } from "@/lib/server/auth/session";
import { seedNewUser } from "@/lib/server/db/seed";
import { users, preferences } from "@/lib/server/db/schema";
import {
  SignupBody,
  normalizeEmail,
  preferencesPayload,
  resolveLang,
} from "@/lib/server/contracts/auth";

export const POST = route(
  "auth.signup",
  async (ctx) => {
    const body = await parseBody(ctx.req, SignupBody);
    const email = normalizeEmail(body.email);

    const existing = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0]) {
      throw new ApiError(409, "AUTH_EMAIL_TAKEN", "Email already registered");
    }

    const lang = resolveLang(body.lang, ctx.req);
    const { hash, salt } = hashPassword(body.password);
    const userId = randomUUID();
    const now = ctx.now;

    await ctx.db.insert(users).values({
      id: userId,
      email,
      name: body.name,
      passwordHash: hash,
      salt,
      planId: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });

    await seedNewUser(ctx.db, userId, { lang });

    const prefRows = await ctx.db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .limit(1);

    const { cookie } = await createSession(
      ctx.db,
      userId,
      false,
      ctx.req.headers.get("user-agent"),
    );

    return json(
      {
        user: { id: userId, name: body.name, email },
        plan: "free",
        preferences: preferencesPayload(prefRows[0]),
      },
      { headers: { "set-cookie": cookie } },
    );
  },
  { auth: "public" },
);
