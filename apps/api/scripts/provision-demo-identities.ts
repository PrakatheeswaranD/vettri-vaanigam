import { prisma } from "../src/db/client.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { purchasableCategories } from "../src/modules/buyer-policy/resolve-policy.js";

if (process.env.NODE_ENV === "production") throw new Error("Demo identities are not permitted in production.");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://127.0.0.1");
const isLocalDatabase = ["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname);
if (!isLocalDatabase && process.env.ALLOW_REMOTE_DEMO_IDENTITIES !== "true") {
  throw new Error("Refusing to provision public demo credentials in a remote database without ALLOW_REMOTE_DEMO_IDENTITIES=true.");
}
for (const identity of [
  { slug: "demo-customer-context", name: "Demo Customer", email: "customer@vettrivaanigam.demo", role: "CUSTOMER" as const, password: "CustomerDemo!2026" },
  { slug: "demo-platform-context", name: "Platform Administration", email: "admin@vettrivaanigam.demo", role: "PLATFORM_ADMIN" as const, password: "AdminDemo!2026" },
]) {
  const context = await prisma.merchant.upsert({ where: { slug: identity.slug }, update: {}, create: { slug: identity.slug, name: identity.name, defaultCurrency: "INR", businessCategory: "Identity context", status: "ACTIVE" } });
  // The shopper's own account, keyed to the identity context's id so a
  // decision record's `protocolActorRef` keeps resolving to them.
  if (identity.role === "CUSTOMER") {
    await prisma.customerAccount.upsert({
      where: { id: context.id },
      update: { displayName: identity.name },
      create: { id: context.id, displayName: identity.name },
    });
  }
  await prisma.merchantUser.upsert({
    where: { email: identity.email },
    update: { customerAccountId: identity.role === "CUSTOMER" ? context.id : null },
    create: { merchantId: context.id, customerAccountId: identity.role === "CUSTOMER" ? context.id : null, email: identity.email, role: identity.role, passwordHash: await hashPassword(identity.password) },
  });
  // Categories come from what is actually purchasable, not a fixed list.
  // The old hard-coded default ("Electronics/Laptop", "Books",
  // "Accessories") is stocked by no merchant here, so the demo customer
  // was provisioned with an allow-list that declined the demo catalogue —
  // every first purchase came back CATEGORY_NOT_ALLOWED. See
  // src/modules/buyer-policy/resolve-policy.ts.
  if (identity.role === "CUSTOMER") {
    // The demo shopper's spending limits are RESET here, not left alone.
    //
    // `update: {}` looks like the careful choice — resolve-policy.ts is
    // emphatic that an existing policy is never silently widened — but
    // this is the demo fixture provisioner, and the rule it was borrowing
    // protects a real shopper's own narrowing, not a fixture's drift.
    //
    // What it actually did was make a bad state unrepairable. Several
    // integration tests raise this shopper's limits to the ₹10,00,000
    // schema maximum to exercise large-basket paths and do not put them
    // back (buyer-autonomy.test.ts, customer-negotiation.test.ts). The
    // README tells a reviewer to run `pnpm test` and then demo — so the
    // documented path left the demo buyer able to autonomously spend ₹10
    // lakh, and re-running this script, the one command that looks like
    // it would repair that, changed nothing.
    //
    // The result was the worst possible demo: the step-up gate, which is
    // the whole safety argument, silently never fired. Restoring the
    // fixture is this script's entire job, so it now does it.
    // Chosen so all three outcomes are reachable against the seeded
    // catalogue, because a control nobody can watch fire is not a control
    // a reviewer has any reason to believe in. Against a ~₹3,489 seeded
    // shoe:
    //
    //   1 unit = ₹3,489   under the ₹5,000 autonomous limit -> AUTO_APPROVE
    //   3 units = ₹10,467 over it, under the hard ceiling    -> STEP_UP
    //   8 units = ₹27,912 over the ₹25,000 hard ceiling      -> DECLINE
    //
    // The gap between the autonomous limit and the hard maximum is the
    // point: above one the buyer is ASKED, above the other they are
    // REFUSED, and those are different questions.
    //
    // The hard ceiling is ₹25,000 rather than something rounder because
    // `POST /buyer/purchase-proposals` caps quantity at 10: a ceiling
    // above 10 units of the seeded shoe (₹34,890) is one no request can
    // reach, so DECLINE would have been dead code in the demo.
    const demoPolicy = {
      allowedCategories: await purchasableCategories(),
      dailyLimitMinor: 10_000_000,
      autonomousPurchaseLimitMinor: 500_000,
      maxPurchaseAmountMinor: 2_500_000,
      autoPurchaseEnabled: true,
      approvalRequiredAboveLimit: true,
    };
    await prisma.buyerSpendingPolicy.upsert({
      where: { customerAccountId: context.id },
      update: demoPolicy,
      create: { customerAccountId: context.id, ...demoPolicy },
    });
  }
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
