import { z } from "zod";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const LangEnum = z.enum(["zh", "zh-TW", "en", "ja"]);
export const ThemeEnum = z.enum(["dark", "light"]);
export const ModeEnum = z.enum(["fast", "expert"]);
export const PlanEnum = z.enum(["free", "pro", "team", "ent"]);
export const SsoProviderEnum = z.enum(["google", "github", "wechat", "apple"]);

export type LangT = z.infer<typeof LangEnum>;
