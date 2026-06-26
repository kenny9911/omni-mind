import { z } from "zod";
import { EMAIL_RE, PlanEnum } from "./common";

export const UserStatusEnum = z.enum(["active", "suspended"]);

/** PATCH /api/profile — update own name and/or change password. */
export const ProfilePatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  })
  .strict()
  .refine((b) => !b.newPassword || (b.currentPassword && b.currentPassword.length > 0), {
    message: "currentPassword is required to set a new password",
    path: ["currentPassword"],
  });
export type ProfilePatchT = z.infer<typeof ProfilePatch>;

/** PATCH /api/admin/users/:id — admin edits a user's name/role/plan/status or resets the password. */
export const AdminUserPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.enum(["user", "admin"]).optional(),
    planId: PlanEnum.optional(),
    status: UserStatusEnum.optional(),
    newPassword: z.string().min(8).max(200).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });
export type AdminUserPatchT = z.infer<typeof AdminUserPatch>;

/** POST /api/admin/users — admin provisions a brand-new account directly. */
export const AdminUserCreate = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().regex(EMAIL_RE),
    password: z.string().min(8).max(200),
    role: z.enum(["user", "admin"]).default("user"),
    planId: PlanEnum.default("free"),
  })
  .strict();
export type AdminUserCreateT = z.infer<typeof AdminUserCreate>;

export interface ProfileStats {
  totalTokens: number;
  modelCostMicro: number;
  platformFeeMicro: number;
  totalMicro: number;
  callCount: number;
  requestCount: number;
}

export interface ProfileDTO {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  isDemo: boolean;
  createdAt: number;
  stats: ProfileStats;
}
