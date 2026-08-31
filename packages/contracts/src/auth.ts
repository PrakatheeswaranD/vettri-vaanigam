import { z } from "zod";

/** PART 10 §1 — real merchant/approver identity wire contracts. */
export const merchantUserRoleSchema = z.enum(["OWNER", "APPROVER", "VIEWER", "CUSTOMER", "PLATFORM_ADMIN"]);
export type MerchantUserRoleDTO = z.infer<typeof merchantUserRoleSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  experience: z.enum(["customer", "merchant", "admin"]).optional(),
});
export type LoginRequestDTO = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    role: merchantUserRoleSchema,
    merchantId: z.string().uuid(),
  }),
});
export type LoginResponseDTO = z.infer<typeof loginResponseSchema>;

export const currentUserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: merchantUserRoleSchema,
  merchantId: z.string().uuid(),
});
export type CurrentUserResponseDTO = z.infer<typeof currentUserResponseSchema>;
