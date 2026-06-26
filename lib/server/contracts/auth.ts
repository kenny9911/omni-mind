import { z } from "zod";
import { EMAIL_RE, LangEnum, SsoProviderEnum, type LangT } from "./common";
import { PLATFORM_FEE_MICRO } from "../llm/cost";
import type { Preference, User } from "../db/schema";

/**
 * Auth & Session contracts (docs/technical-design.md §2.1).
 * Zod request schemas + DTO mappers for signup/login/logout/session/sso.
 */

export const SignupBody = z.object({
  name: z.string().min(1),
  email: z.string().regex(EMAIL_RE),
  password: z.string().min(8),
  lang: LangEnum.optional(),
});
export type SignupBodyT = z.infer<typeof SignupBody>;

export const LoginBody = z.object({
  email: z.string(),
  password: z.string(),
  remember: z.boolean().default(false),
});
export type LoginBodyT = z.infer<typeof LoginBody>;

export const SsoBody = z.object({
  provider: SsoProviderEnum,
});
export type SsoBodyT = z.infer<typeof SsoBody>;

/** trim + lowercase, per schema invariant (users.email is normalized). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Public user shape (never exposes password_hash/salt). */
export function userDto(u: User): { id: string; name: string; email: string } {
  return { id: u.id, name: u.name, email: u.email };
}

/** User shape including role + demo flag, for GET /api/auth/session. */
export function userWithRoleDto(u: User): {
  id: string;
  name: string;
  email: string;
  role: string;
  isDemo: boolean;
} {
  return { id: u.id, name: u.name, email: u.email, role: u.role, isDemo: u.isDemo };
}

export interface PreferencesPayload {
  theme: string;
  lang: string;
  mode: string;
  auto: boolean;
  mainModel: string;
  trio: string[];
  deepResearch: boolean;
  deepAgents: boolean;
  platformFeePerCallMicro: number;
  platformFeeDisplayMicro: number;
}

/** Build the preferences payload (US9.UC1 shape), parsing trio_json safely. */
export function preferencesPayload(p: Preference): PreferencesPayload {
  let trio: string[];
  try {
    const parsed = JSON.parse(p.trioJson) as unknown;
    trio = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    trio = [];
  }
  return {
    theme: p.theme,
    lang: p.lang,
    mode: p.mode,
    auto: p.auto,
    mainModel: p.mainModel,
    trio,
    deepResearch: p.deepResearch,
    deepAgents: p.deepAgents,
    platformFeePerCallMicro: PLATFORM_FEE_MICRO(),
    platformFeeDisplayMicro: p.platformFeeDisplayMicro,
  };
}

/** Resolve preferred lang from explicit body value or the Accept-Language header (default zh). */
export function resolveLang(explicit: LangT | undefined, req: Request): LangT {
  if (explicit) return explicit;
  const header = req.headers.get("accept-language");
  if (!header) return "zh";
  const tags = header
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .filter(Boolean);
  for (const tag of tags) {
    if (tag === "zh-tw" || tag === "zh-hant" || tag.startsWith("zh-hant")) return "zh-TW";
    if (tag === "zh" || tag.startsWith("zh-")) return "zh";
    if (tag === "ja" || tag.startsWith("ja-")) return "ja";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "zh";
}
