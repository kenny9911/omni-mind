import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { loadMemory, clearMemory } from "@/lib/server/llm/memory";

/** GET /api/memory — the compact, distilled facts OmniMind remembers about the caller. */
export const GET = route(
  "memory.get",
  async (ctx) => {
    const user = requireUser(ctx);
    const { facts, updatedAt } = await loadMemory(ctx.db, user.id);
    return { facts, updatedAt };
  },
  { auth: "required" },
);

/** DELETE /api/memory — wipe what we've learned about the caller. */
export const DELETE = route(
  "memory.clear",
  async (ctx) => {
    const user = requireUser(ctx);
    await clearMemory(ctx.db, user.id);
    ctx.setMeta({ cleared: true });
    return { cleared: true };
  },
  { auth: "required" },
);
