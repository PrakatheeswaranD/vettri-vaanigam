import type { FastifyInstance } from "fastify";
import { loginRequestSchema, type CurrentUserResponseDTO } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { login, logout } from "./service.js";
import { findMerchantUserById } from "./repository.js";

export function registerAuthRoutes(app: FastifyInstance, prefix: string): void {
  // Deliberately NOT behind the auth middleware (see middleware.ts's
  // allowlist) — you cannot require a session to obtain one.
  app.post(`${prefix}/auth/login`, async (request) => {
    const body = loginRequestSchema.parse(request.body);
    return login(prisma, body.email, body.password, body.experience);
  });

  app.post(`${prefix}/auth/logout`, async (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
    if (token) await logout(prisma, token);
    return { ok: true };
  });

  app.get(`${prefix}/auth/me`, async (request): Promise<CurrentUserResponseDTO> => {
    const user = await findMerchantUserById(prisma, request.merchantUserId);
    if (!user) throw AppError.unauthorized("Session user no longer exists.");
    return { id: user.id, email: user.email, role: user.role, merchantId: user.merchantId };
  });
}
