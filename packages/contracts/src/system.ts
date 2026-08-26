import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("razorgrowth-api"),
});
export type HealthResponseDTO = z.infer<typeof healthResponseSchema>;

export const systemReadinessResponseSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.object({
    api: z.literal("ok"),
    database: z.enum(["ok", "unreachable"]),
  }),
});
export type SystemReadinessResponseDTO = z.infer<typeof systemReadinessResponseSchema>;
