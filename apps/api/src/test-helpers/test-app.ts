/**
 * Test app factory (PART 10 §1). Every existing integration test file
 * called the raw `buildApp()` + `app.ready()` and then fired unauthenticated
 * `app.inject(...)` calls — which the new global auth gate
 * (`auth/middleware.ts`) now rejects with 401. Rather than touching all
 * ~87 individual `inject` call sites across 9 test files, this factory
 * logs in as the real seeded demo merchant user once and wraps `.inject`
 * to attach that session's Authorization header by default. A test that
 * needs to exercise unauthenticated/invalid-token behavior can still
 * override it explicitly by passing its own `headers.authorization`.
 */
import { buildApp } from "../app.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { DEMO_MERCHANT_SLUG } from "../modules/authorization/demo-context.js";
import { AppError } from "../http/errors.js";

export const TEST_MERCHANT_EMAIL = "owner@meridianathletics.demo";
export const TEST_MERCHANT_PASSWORD = "MeridianDemo!2026";

/**
 * Resolves the seeded demo merchant's id directly for tests that call
 * service-layer functions rather than going through an authenticated HTTP
 * request (which is how `getAuthenticatedMerchantId` resolves it in
 * production route handlers).
 */
export async function getTestMerchantId(prisma: PrismaClient): Promise<string> {
  const merchant = await prisma.merchant.findUnique({ where: { slug: DEMO_MERCHANT_SLUG } });
  if (!merchant) {
    throw new AppError("INTERNAL_ERROR", `Seeded demo merchant "${DEMO_MERCHANT_SLUG}" not found. Has "pnpm db:seed" been run?`);
  }
  return merchant.id;
}

/**
 * Resolves the seeded demo merchant OWNER's real user id — the identity
 * that `buildAuthedTestApp()` authenticates as, and therefore the id every
 * `Approval.approverId` recorded during a test should carry.
 */
export async function getTestMerchantUserId(prisma: PrismaClient): Promise<string> {
  const merchantUser = await prisma.merchantUser.findUnique({ where: { email: TEST_MERCHANT_EMAIL } });
  if (!merchantUser) {
    throw new AppError("INTERNAL_ERROR", `Seeded demo merchant user "${TEST_MERCHANT_EMAIL}" not found. Has "pnpm db:seed" been run?`);
  }
  return merchantUser.id;
}

export async function buildAuthedTestApp(): Promise<FastifyInstance> {
  const app = buildApp();
  await app.ready();

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: TEST_MERCHANT_EMAIL, password: TEST_MERCHANT_PASSWORD },
  });
  if (loginRes.statusCode !== 200) {
    throw new Error(
      `Test login failed (${loginRes.statusCode}): ${loginRes.body}. Has "pnpm db:seed" been run against this database?`,
    );
  }
  const token = (loginRes.json() as { token: string }).token;
  const defaultAuthHeader = `Bearer ${token}`;

  const originalInject = app.inject.bind(app);
  app.inject = ((opts: InjectOptions | string) => {
    const normalized: InjectOptions = typeof opts === "string" ? { url: opts } : opts;
    return originalInject({
      ...normalized,
      headers: { authorization: defaultAuthHeader, ...normalized.headers },
    });
  }) as typeof app.inject;

  return app;
}
