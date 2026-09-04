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

/** The demo shopper, created by `scripts/provision-demo-identities.ts`
 * (NOT by `prisma/seed.ts` — see `buildCustomerTestApp` below). */
export const TEST_CUSTOMER_EMAIL = "customer@vettrivaanigam.demo";
export const TEST_CUSTOMER_PASSWORD = "CustomerDemo!2026";

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

async function buildSessionTestApp(
  email: string,
  password: string,
  remedy: string,
): Promise<FastifyInstance> {
  const app = buildApp();
  await app.ready();

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  if (loginRes.statusCode !== 200) {
    throw new Error(
      `Test login failed for ${email} (${loginRes.statusCode}): ${loginRes.body}. ${remedy}`,
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

/** A MERCHANT-side session (the seeded demo owner). Use for anything under
 * the merchant management surface. */
export async function buildAuthedTestApp(): Promise<FastifyInstance> {
  return buildSessionTestApp(
    TEST_MERCHANT_EMAIL,
    TEST_MERCHANT_PASSWORD,
    'Has "pnpm db:seed" been run against this database?',
  );
}

/**
 * A SHOPPER session.
 *
 * Every customer-surface test used to drive `/buyer/*` with the merchant
 * session above, which worked only because nothing yet enforced the split
 * between "the person selling" and "the person buying". The moment that
 * split was enforced, five suites turned red at once — not because the
 * behaviour under test broke, but because the tests had never actually
 * been exercising a shopper.
 *
 * The demo shopper is created by `scripts/provision-demo-identities.ts`,
 * which `prisma/seed.ts` does NOT call, so the failure message says so
 * rather than sending the reader to re-run a seed that was never going to
 * produce this account.
 */
export async function buildCustomerTestApp(): Promise<FastifyInstance> {
  return buildSessionTestApp(
    TEST_CUSTOMER_EMAIL,
    TEST_CUSTOMER_PASSWORD,
    'The demo shopper comes from "pnpm --filter @razorgrowth/api exec tsx scripts/provision-demo-identities.ts", not from db:seed.',
  );
}

/** The shopper's own account id — what `/buyer/*` routes partition
 * their rows by. Read from `customerAccountId`, not `merchantId`: those
 * held the same value while a shopper was filed under a synthetic
 * merchant, and reading the merchant column here would keep the two
 * meanings tangled after the schema stopped tangling them. */
export async function getTestBuyerContextId(prisma: PrismaClient): Promise<string> {
  const customer = await prisma.merchantUser.findUnique({
    where: { email: TEST_CUSTOMER_EMAIL },
    select: { customerAccountId: true },
  });
  if (!customer?.customerAccountId) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Demo shopper "${TEST_CUSTOMER_EMAIL}" has no customer account. Run scripts/provision-demo-identities.ts.`,
    );
  }
  return customer.customerAccountId;
}
