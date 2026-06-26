import { eq } from "drizzle-orm";
import { route, ApiError, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { MODELS, OPENROUTER_MODELS } from "@/lib/server/llm/registry";
import { modelState, preferences } from "@/lib/server/db/schema";
import type { Lang } from "@/lib/types";
import {
  ModelsQuery,
  buildModelDTO,
  mapOpenRouter,
} from "@/lib/server/contracts/models";

const isGateway = () => process.env.LLM_MODE === "gateway";
const hasGatewayKey = () => Boolean(process.env.AI_GATEWAY_API_KEY);

/**
 * GET /api/models (US5.UC1/UC4/UC5).
 * - `?gateway=openrouter` → `{ models: OpenRouterDTO[] }` (gateway mode w/o key → 503).
 * - else → `{ models: ModelDTO[12], openRouter: string[] }`.
 */
export const GET = route(
  "models.list",
  async (ctx) => {
    const user = requireUser(ctx);
    const q = parseQuery(ctx.url, ModelsQuery);

    if (q.gateway === "openrouter") {
      ctx.setMeta({ gateway: "openrouter" });
      // Gateway mode requires a key to list OpenRouter models.
      if (isGateway() && !hasGatewayKey()) {
        throw new ApiError(
          503,
          "GATEWAY_UNAVAILABLE",
          "OpenRouter gateway is not configured",
        );
      }
      return { models: mapOpenRouter(OPENROUTER_MODELS) };
    }

    const [pref] = await ctx.db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, user.id))
      .limit(1);
    const lang: Lang = (q.lang ?? (pref?.lang as Lang) ?? "zh") as Lang;
    const mainModel = pref?.mainModel ?? "gpt-55";

    const stateRows = await ctx.db
      .select()
      .from(modelState)
      .where(eq(modelState.userId, user.id));
    const enabledMap: Record<string, boolean> = {};
    for (const row of stateRows) enabledMap[row.modelId] = row.enabled;

    const models = MODELS.map((m) =>
      buildModelDTO(m, { enabledMap, mainModel, lang }),
    );

    return { models, openRouter: OPENROUTER_MODELS };
  },
  { auth: "required" },
);
