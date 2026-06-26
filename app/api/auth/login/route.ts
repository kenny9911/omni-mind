import { eq } from "drizzle-orm";
import { route, json, ApiError, parseBody } from "@/lib/server/http";
import { verifyPassword, hashPassword } from "@/lib/server/auth/password";
import { createSession } from "@/lib/server/auth/session";
import { users } from "@/lib/server/db/schema";
import { LoginBody, normalizeEmail, userDto } from "@/lib/server/contracts/auth";

// A throwaway hash so the unknown-email path pays the same scrypt cost as a real
// verify — equivalent timing for unknown-email vs wrong-password (no enumeration).
const DUMMY = hashPassword("omnimind-timing-equalizer");

export const POST = route(
  "auth.login",
  async (ctx) => {
    const body = await parseBody(ctx.req, LoginBody);
    const email = normalizeEmail(body.email);

    const rows = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];

    // Identical failure + equivalent timing for unknown email vs wrong password (US1.UC2).
    let valid = false;
    if (user) {
      valid = verifyPassword(body.password, user.passwordHash, user.salt);
    } else {
      verifyPassword(body.password, DUMMY.hash, DUMMY.salt); // constant-time work
    }
    if (!valid) {
      throw new ApiError(401, "AUTH_INVALID", "Invalid email or password");
    }

    const { cookie } = await createSession(
      ctx.db,
      user.id,
      body.remember,
      ctx.req.headers.get("user-agent"),
    );

    return json(
      { user: userDto(user), plan: user.planId },
      { headers: { "set-cookie": cookie } },
    );
  },
  { auth: "public" },
);
