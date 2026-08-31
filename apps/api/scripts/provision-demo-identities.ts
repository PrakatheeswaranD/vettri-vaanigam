import { prisma } from "../src/db/client.js";
import { hashPassword } from "../src/modules/auth/password.js";

if (process.env.NODE_ENV === "production") throw new Error("Demo identities are not permitted in production.");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://127.0.0.1");
const isLocalDatabase = ["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname);
if (!isLocalDatabase && process.env.ALLOW_REMOTE_DEMO_IDENTITIES !== "true") {
  throw new Error("Refusing to provision public demo credentials in a remote database without ALLOW_REMOTE_DEMO_IDENTITIES=true.");
}
for (const identity of [
  { slug: "demo-customer-context", name: "Demo Customer", email: "customer@anumati.demo", role: "CUSTOMER" as const, password: "CustomerDemo!2026" },
  { slug: "demo-platform-context", name: "Platform Administration", email: "admin@anumati.demo", role: "PLATFORM_ADMIN" as const, password: "AdminDemo!2026" },
]) {
  const context = await prisma.merchant.upsert({ where: { slug: identity.slug }, update: {}, create: { slug: identity.slug, name: identity.name, defaultCurrency: "INR", businessCategory: "Identity context", status: "ACTIVE" } });
  await prisma.merchantUser.upsert({ where: { email: identity.email }, update: {}, create: { merchantId: context.id, email: identity.email, role: identity.role, passwordHash: await hashPassword(identity.password) } });
  if (identity.role === "CUSTOMER") await prisma.buyerSpendingPolicy.upsert({ where: { merchantId: context.id }, update: {}, create: { merchantId: context.id, allowedCategories: ["Electronics/Laptop", "Books", "Accessories"], dailyLimitMinor: 10_000_000, autonomousPurchaseLimitMinor: 200_000 } });
  console.log(`Demo ${identity.role} identity is available. Existing merchant data was not reset.`);
}

// Dedicated synthetic evidence for the one-click Admin failure demo. It is
// isolated in an Identity context, has no catalog products or checkout, and
// never rewrites a historical merchant payment to claim debit evidence that
// the provider did not supply.
const failureContext = await prisma.merchant.upsert({
  where: { slug: "demo-failure-evidence-context" },
  update: {},
  create: { slug: "demo-failure-evidence-context", name: "Failure Demo Evidence", defaultCurrency: "INR", businessCategory: "Identity context", status: "ACTIVE" },
});
const existingFailureOrder = await prisma.order.findFirst({ where: { merchantId: failureContext.id, source: "ADMIN_FAILURE_DEMO" } });
if (!existingFailureOrder) {
  const order = await prisma.order.create({ data: { merchantId: failureContext.id, status: "FAILED", totalAmountMinor: 249_900, currency: "INR", source: "ADMIN_FAILURE_DEMO" } });
  await prisma.payment.create({ data: { merchantId: failureContext.id, orderId: order.id, provider: "DEMO", amountMinor: order.totalAmountMinor, currency: order.currency, state: "FAILED", customerDebitStatus: "DEBITED", merchantCreditStatus: "NOT_CREDITED", automaticRetryBlocked: true, failureCode: "DEMO_CREDIT_TIMEOUT", failureCategory: "DEBIT_CREDIT_MISMATCH", providerMetadata: { syntheticDemoEvidence: true, disclosure: "No real payment or money movement occurred." }, failedAt: new Date() } });
  console.log("Synthetic failure-first evidence is available. No historical payment was modified.");
}
await prisma.$disconnect();
