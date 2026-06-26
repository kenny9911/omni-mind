import { z } from "zod";
import { PlanEnum } from "./common";

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

/** PATCH /api/admin/users/:id — admin edits a user's name/role/plan. */
export const AdminUserPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.enum(["user", "admin"]).optional(),
    planId: PlanEnum.optional(),
  })
  .strict();
export type AdminUserPatchT = z.infer<typeof AdminUserPatch>;

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
