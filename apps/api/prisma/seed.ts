/**
 * Deterministic demo data (PART 00 §28; PART 01 §21, §22).
 *
 * One controlled merchant ("Meridian Athletics", a fictional running/
 * lifestyle retailer — chosen per PART 01 §21 because its catalog
 * naturally supports cross-sell/upsell/bundling scenarios). Running this
 * script repeatedly is safe: it deletes only this merchant's own rows (in
 * FK-safe dependency order) and recreates them, so it never accumulates
 * uncontrolled duplicates and never touches unrelated data.
 *
 * All financial amounts are integer minor units (PART 00 §16). All
 * payment history uses `provider: "DEMO"` (PART 01 §77) — never
 * `"RAZORPAY"` — so seeded rows can never be mistaken for real Test Mode
 * transactions.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { fixedClock } from "@razorgrowth/domain";
import { runReadinessAssessment } from "../src/modules/readiness/engine.js";
import { appendLedgerEvent, type AppendLedgerEventParams } from "../src/modules/audit/ledger.js";

const prisma = new PrismaClient();

const MERCHANT_SLUG = "meridian-athletics";

/** mulberry32 — small deterministic PRNG so "randomized" seed choices
 * (which customer, which variant, which quantity) are reproducible across
 * every environment and every re-run, without hardcoding every value. */
function createRng(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = createRng(20260101);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

interface ProductSeed {
  name: string;
  category: string;
  description: string;
  sizes: readonly string[];
  basePriceMinor: number;
  includePolicyInfo: boolean;
}

const PRODUCTS: ProductSeed[] = [
  // Running Shoes
  { name: "Meridian Pulse Runner", category: "Running Shoes", description: "Everyday neutral trainer tuned for tempo runs, with a responsive foam midsole.", sizes: ["UK7", "UK8", "UK9", "UK10"], basePriceMinor: 449900, includePolicyInfo: true },
  { name: "Meridian Trailblaze GTX", category: "Running Shoes", description: "Waterproof trail shoe with an aggressive lug pattern for technical terrain.", sizes: ["UK7", "UK8", "UK9", "UK10"], basePriceMinor: 549900, includePolicyInfo: true },
  { name: "Meridian Velocity Racer", category: "Running Shoes", description: "Carbon-plated racing shoe built for race-day speed.", sizes: ["UK7", "UK8", "UK9"], basePriceMinor: 799900, includePolicyInfo: true },
  { name: "Meridian Cloudstep Comfort", category: "Running Shoes", description: "Maximum-cushion daily trainer for high-mileage recovery runs.", sizes: ["UK7", "UK8", "UK9", "UK10", "UK11"], basePriceMinor: 429900, includePolicyInfo: true },
  { name: "Meridian Summit Trail", category: "Running Shoes", description: "Rugged trail runner with rock-plate protection for long mountain routes.", sizes: ["UK8", "UK9", "UK10"], basePriceMinor: 579900, includePolicyInfo: false },
  { name: "Meridian Aero Lightweight", category: "Running Shoes", description: "Ultra-light training shoe for speed sessions and intervals.", sizes: ["UK7", "UK8", "UK9"], basePriceMinor: 469900, includePolicyInfo: true },
  // Sportswear
  { name: "Meridian DriFit Training Tee", category: "Sportswear", description: "Moisture-wicking training tee with flatlock seams to prevent chafing.", sizes: ["S", "M", "L", "XL"], basePriceMinor: 99900, includePolicyInfo: true },
  { name: "Meridian Momentum Leggings", category: "Sportswear", description: "Four-way stretch leggings with a hidden waistband pocket.", sizes: ["S", "M", "L"], basePriceMinor: 179900, includePolicyInfo: true },
  { name: "Meridian Windshield Jacket", category: "Sportswear", description: "Packable wind-resistant shell for cold-weather runs.", sizes: ["S", "M", "L", "XL"], basePriceMinor: 249900, includePolicyInfo: true },
  { name: "Meridian Flex Shorts", category: "Sportswear", description: "Lightweight running shorts with a built-in liner.", sizes: ["S", "M", "L", "XL"], basePriceMinor: 139900, includePolicyInfo: false },
  { name: "Meridian ThermaCore Half-Zip", category: "Sportswear", description: "Brushed-interior half-zip for cold-morning starts.", sizes: ["S", "M", "L"], basePriceMinor: 229900, includePolicyInfo: true },
  { name: "Meridian Compression Base Layer", category: "Sportswear", description: "Graduated compression layer to support muscle recovery.", sizes: ["S", "M", "L", "XL"], basePriceMinor: 159900, includePolicyInfo: true },
  // Socks
  { name: "Meridian CoolMax Running Socks", category: "Socks", description: "Breathable cushioned socks with arch support, sold as a pair.", sizes: ["S/M", "L/XL"], basePriceMinor: 39900, includePolicyInfo: true },
  { name: "Meridian Cushion Crew Socks", category: "Socks", description: "Extra-cushioned crew socks for long-distance comfort.", sizes: ["S/M", "L/XL"], basePriceMinor: 44900, includePolicyInfo: true },
  { name: "Meridian No-Show Performance Socks", category: "Socks", description: "Low-profile socks that stay hidden below the shoe collar.", sizes: ["S/M", "L/XL"], basePriceMinor: 34900, includePolicyInfo: false },
  { name: "Meridian Merino Trail Socks", category: "Socks", description: "Merino wool blend socks for temperature regulation on the trail.", sizes: ["S/M", "L/XL"], basePriceMinor: 54900, includePolicyInfo: true },
  // Hydration
  { name: "Meridian FlowFit Handheld Bottle", category: "Hydration", description: "250ml handheld soft flask with an adjustable strap.", sizes: ["250ml"], basePriceMinor: 89900, includePolicyInfo: true },
  { name: "Meridian TrailPack Hydration Vest", category: "Hydration", description: "6-litre hydration vest with two 500ml soft flasks included.", sizes: ["S/M", "L/XL"], basePriceMinor: 349900, includePolicyInfo: true },
  { name: "Meridian InsulaFlask 750", category: "Hydration", description: "Insulated 750ml bottle that keeps drinks cold for up to 12 hours.", sizes: ["750ml"], basePriceMinor: 119900, includePolicyInfo: false },
  { name: "Meridian QuickBelt Hydration Belt", category: "Hydration", description: "Adjustable belt with two 200ml flasks for race day.", sizes: ["One Size"], basePriceMinor: 129900, includePolicyInfo: true },
  // Accessories
  { name: "Meridian ReflectBand Armband", category: "Accessories", description: "Reflective phone armband for low-visibility runs.", sizes: ["One Size"], basePriceMinor: 59900, includePolicyInfo: true },
  { name: "Meridian AeroCap Running Hat", category: "Accessories", description: "Lightweight ventilated cap with sweat-wicking sweatband.", sizes: ["One Size"], basePriceMinor: 69900, includePolicyInfo: true },
  { name: "Meridian GripFit Gloves", category: "Accessories", description: "Touchscreen-compatible running gloves for cold starts.", sizes: ["S/M", "L/XL"], basePriceMinor: 79900, includePolicyInfo: false },
  { name: "Meridian PulseTrack Chest Strap", category: "Accessories", description: "Bluetooth heart-rate chest strap, compatible with major running apps.", sizes: ["One Size"], basePriceMinor: 249900, includePolicyInfo: true },
  { name: "Meridian StrideLace Kit", category: "Accessories", description: "Elastic no-tie lace kit for a secure, adjustable fit.", sizes: ["One Size"], basePriceMinor: 24900, includePolicyInfo: true },
];

// PART 03 §131 — the Buyer Agent demo scenario needs a real color
// attribute to filter on ("black running shoes"), not just size. Scoped to
// categories where color is a meaningful buying attribute, in a fixed
// deterministic rotation so the seed stays fully reproducible.
const COLORS_BY_CATEGORY: Record<string, readonly string[]> = {
  "Running Shoes": ["Black", "Grey", "Blue", "Red"],
  Sportswear: ["Black", "Grey", "Navy"],
};

const CUSTOMERS: { displayName: string; email: string; segment: string }[] = [
  { displayName: "Ananya Rao", email: "ananya.rao@example.com", segment: "vip" },
  { displayName: "Rohan Mehta", email: "rohan.mehta@example.com", segment: "frequent_buyer" },
  { displayName: "Priya Nair", email: "priya.nair@example.com", segment: "new" },
  { displayName: "Karan Malhotra", email: "karan.malhotra@example.com", segment: "frequent_buyer" },
  { displayName: "Sneha Iyer", email: "sneha.iyer@example.com", segment: "vip" },
  { displayName: "Vikram Singh", email: "vikram.singh@example.com", segment: "new" },
  { displayName: "Divya Krishnan", email: "divya.krishnan@example.com", segment: "frequent_buyer" },
  { displayName: "Arjun Kapoor", email: "arjun.kapoor@example.com", segment: "new" },
];

/** Delete this merchant's rows in FK-safe dependency order (leaf tables
 * first). Kept explicit rather than relying on cascading deletes so
 * re-running the seed is safe regardless of any individual relation's
 * onDelete policy. */
async function resetDemoMerchant(merchantSlug: string) {
  const existing = await prisma.merchant.findUnique({ where: { slug: merchantSlug } });
  if (!existing) return;
  const merchantId = existing.id;

  // PART 07 §17: `Payment` RESTRICTs deletion of the `CheckoutSession` it
  // belongs to, so it must be deleted first; PART 06 §141:
  // `CheckoutSession` in turn RESTRICTs deletion of `Cart`, `Order`, and
  // `ExecutionAuthorization` (the last of which cascades from
  // `GrowthActionProposal`) — it must be deleted before those. A demo
  // merchant that has ever completed a real checkout or payment attempt
  // can only be reset if this order is respected.
  await prisma.idempotencyRecord.deleteMany({ where: { merchantId } });
  await prisma.paymentProviderEvent.deleteMany({ where: { merchantId } });
  await prisma.payment.deleteMany({ where: { merchantId } });
  await prisma.checkoutSession.deleteMany({ where: { merchantId } });
  await prisma.growthActionProposal.deleteMany({ where: { merchantId } });
  await prisma.productRelationship.deleteMany({ where: { merchantId } });
  await prisma.merchantGrowthConfig.deleteMany({ where: { merchantId } });
  await prisma.recommendationRecord.deleteMany({ where: { merchantId } });
  await prisma.buyerMessage.deleteMany({ where: { conversation: { merchantId } } });
  await prisma.buyerConversation.deleteMany({ where: { merchantId } });
  await prisma.orderItem.deleteMany({ where: { order: { merchantId } } });
  await prisma.order.deleteMany({ where: { merchantId } });
  await prisma.cartItem.deleteMany({ where: { cart: { merchantId } } });
  await prisma.cart.deleteMany({ where: { merchantId } });
  await prisma.agentAction.deleteMany({ where: { merchantId } });
  await prisma.readinessSnapshot.deleteMany({ where: { merchantId } });
  await prisma.growthOpportunity.deleteMany({ where: { merchantId } });
  await prisma.inventory.deleteMany({ where: { variant: { product: { merchantId } } } });
  await prisma.productVariant.deleteMany({ where: { product: { merchantId } } });
  await prisma.product.deleteMany({ where: { merchantId } });
  await prisma.customer.deleteMany({ where: { merchantId } });
  await prisma.merchantPolicy.deleteMany({ where: { merchantId } });
  await prisma.merchant.delete({ where: { id: merchantId } });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** PART 09 §84 — this script destructively deletes and recreates one
 * merchant's data on every run. That's safe for its intended demo/dev
 * use, but this guard stops it from being run unattended against a real
 * production database (`NODE_ENV=production`) without an explicit,
 * deliberate override. */
function assertSafeToSeed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    console.error(
      "[seed] refusing to run: NODE_ENV=production. This script is DEMO/DEVELOPMENT ONLY " +
        "and destructively resets one merchant's data. Set ALLOW_PRODUCTION_SEED=true if you " +
        "are certain this is intended.",
    );
    process.exit(1);
  }
}

async function main() {
  assertSafeToSeed();
  console.log(`[seed] resetting demo merchant "${MERCHANT_SLUG}" (if present)...`);
  await resetDemoMerchant(MERCHANT_SLUG);

  console.log("[seed] creating merchant...");
  const merchant = await prisma.merchant.create({
    data: {
      name: "Meridian Athletics",
      slug: MERCHANT_SLUG,
      description:
        "A performance running and lifestyle retailer, built as a controlled demo merchant for RazorGrowth AI (PART 00 §36 — one controlled merchant, no production multi-tenancy).",
      defaultCurrency: "INR",
      businessCategory: "Sports & Running Retail",
      status: "ACTIVE",
    },
  });

  // PART 05 §114 demo policy: chosen so all three policy outcomes are
  // reachable with real seeded products — a small discount auto-allows, a
  // moderate one requires approval, and a large one is denied outright.
  // Deliberately `maxDiscountBps` (800 = 8%) < `MerchantGrowthConfig`'s own
  // `maxProposedDiscountBps` (1000 = 10%, PART 04's agent-shape ceiling) —
  // real defense in depth: the Merchant Agent can still shape a proposal up
  // to 10% and have it persist as a normal `PROPOSED` row, but deterministic
  // policy governs what may actually proceed, and denies anything above 8%
  // even though the agent layer already let it through.
  await prisma.merchantPolicy.create({
    data: {
      merchantId: merchant.id,
      policyVersion: 1,
      currency: "INR",
      maxDiscountBps: 800, // 8% hard ceiling (policy)
      autoApprovalDiscountBps: 300, // <=3% auto-allowed
      maxOrderAmountMinor: 5_000_000, // ₹50,000.00 hard ceiling
      autoApprovalOrderAmountMinor: 500_000, // <=₹5,000.00 auto-allowed
      maxRecoveryAttempts: 2,
      proposalValidityMinutes: 30,
      approvalValidityMinutes: 15,
      authorizationValidityMinutes: 10,
    },
  });

  console.log("[seed] creating customers...");
  // Sequential, not Promise.all: the local PGlite-socket dev database
  // (see scripts/db-server.mjs) handles a burst of concurrent connections
  // unreliably (see PROGRESS.md) — real Postgres would not need this.
  const customers = [];
  for (const c of CUSTOMERS) {
    customers.push(
      await prisma.customer.create({
        data: { merchantId: merchant.id, displayName: c.displayName, email: c.email, segment: c.segment },
      }),
    );
  }

  console.log(`[seed] creating ${PRODUCTS.length} products with variants + inventory...`);
  const now = Date.now();
  const allVariants: { id: string; priceMinor: number; sku: string; productName: string }[] = [];
  const productsMissingPolicy: string[] = [];
  // PART 04 §106, §130 — the growth-config demo needs a deterministic
  // blocked-opportunity scenario (a real relationship exists, but missing
  // machine-readable inventory prevents a safe proposal). Forced here
  // rather than left to chance so the demo is reproducible.
  const PRODUCTS_WITH_FORCED_UNKNOWN_INVENTORY = new Set(["Meridian QuickBelt Hydration Belt"]);
  const productsByName: Record<string, string> = {};

  // PART 02 §123-124 — deliberate, realistic imperfections so the
  // readiness engine has genuine evidence to score against instead of a
  // uniformly perfect catalog. Selected deterministically by index (not
  // randomly) so the seed remains fully reproducible.
  let productIndex = 0;
  let globalVariantIndex = 0;

  for (const p of PRODUCTS) {
    const slug = slugify(p.name);
    // Roughly a third ELIGIBLE, one in seven INELIGIBLE, the rest left at
    // the UNKNOWN default — a merchant that hasn't decided is realistic,
    // not an oversight (PART 02 §57, §9).
    const promotionEligibility =
      productIndex % 7 === 0 ? "INELIGIBLE" : productIndex % 3 === 0 ? "ELIGIBLE" : undefined;

    const product = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: p.name,
        slug,
        description: p.description,
        category: p.category,
        brand: "Meridian",
        status: "ACTIVE",
        returnPolicySummary: p.includePolicyInfo
          ? "Free returns within 30 days in original condition; refund issued to original payment method."
          : null,
        shippingSummary: p.includePolicyInfo ? "Ships within 2 business days; free shipping over ₹2,000." : null,
        ...(promotionEligibility ? { promotionEligibility } : {}),
      },
    });
    if (!p.includePolicyInfo) productsMissingPolicy.push(p.name);
    productsByName[p.name] = product.id;

    for (const size of p.sizes) {
      const skuSuffix = size.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      const sku = `${slug.toUpperCase().replace(/-/g, "")}-${skuSuffix}`;
      const priceMinor = p.basePriceMinor + int(0, 3) * 100; // tiny deterministic variance, still integer minor units

      // Every 11th variant: stale pricing (35 days old) — feeds Price
      // Freshness evidence with a real signal instead of uniform freshness.
      const isStalePrice = globalVariantIndex % 11 === 5;
      const priceUpdatedAt = isStalePrice ? new Date(now - 35 * 24 * 60 * 60 * 1000) : new Date(now);

      // Every 9th variant: no structured attributes recorded — feeds
      // Metadata Quality / AI Discoverability evidence honestly.
      const hasAttributes = globalVariantIndex % 9 !== 4;

      // Every 13th variant: discontinued (inactive).
      const isActive = globalVariantIndex % 13 !== 6;

      const colors = COLORS_BY_CATEGORY[p.category];
      const color = colors ? pick(colors) : null;

      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku,
          title: `${p.name} — ${size}${color ? ` (${color})` : ""}`,
          priceMinor,
          currency: "INR",
          attributes: hasAttributes ? { size, ...(color ? { color } : {}) } : {},
          active: isActive,
          priceUpdatedAt,
        },
      });

      // Every 8th variant: inventory has never been recorded at all — a
      // real UNKNOWN state (PART 02 §9), not a fabricated "in stock").
      // Forced additionally for the PART 04 blocked-opportunity demo product.
      const hasKnownInventory = globalVariantIndex % 8 !== 3 && !PRODUCTS_WITH_FORCED_UNKNOWN_INVENTORY.has(p.name);
      if (hasKnownInventory) {
        const availableQuantity = int(0, 40);
        await prisma.inventory.create({
          data: { variantId: variant.id, availableQuantity, updatedAt: priceUpdatedAt },
        });
      }

      allVariants.push({ id: variant.id, priceMinor, sku, productName: p.name });
      globalVariantIndex++;
    }
    productIndex++;
  }

  console.log("[seed] creating historical orders + payments...");
  const orderSpecs: { status: "PAID" | "FAILED" | "PENDING"; paymentState: "CAPTURED" | "FAILED" | "CREATED"; failureCategory: string | null }[] = [
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCategory: null },
    { status: "FAILED", paymentState: "FAILED", failureCategory: "CARD_DECLINED" },
    { status: "FAILED", paymentState: "FAILED", failureCategory: "INSUFFICIENT_FUNDS" },
    { status: "FAILED", paymentState: "FAILED", failureCategory: "BANK_TIMEOUT" },
    { status: "PENDING", paymentState: "CREATED", failureCategory: null },
    { status: "PENDING", paymentState: "CREATED", failureCategory: null },
  ];

  for (let i = 0; i < orderSpecs.length; i++) {
    const spec = orderSpecs[i]!;
    const customer = pick(customers);
    const itemCount = int(1, 3);
    const chosenVariants = Array.from({ length: itemCount }, () => pick(allVariants));
    const quantities = chosenVariants.map(() => int(1, 2));
    const totalAmountMinor = chosenVariants.reduce((sum, v, idx) => sum + v.priceMinor * quantities[idx]!, 0);
    const createdAt = new Date(now - (orderSpecs.length - i) * 36 * 60 * 60 * 1000); // spread over past ~3 weeks

    const order = await prisma.order.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: spec.status,
        totalAmountMinor,
        currency: "INR",
        source: "direct",
        createdAt,
        updatedAt: createdAt,
      },
    });

    for (let idx = 0; idx < chosenVariants.length; idx++) {
      const v = chosenVariants[idx]!;
      const quantity = quantities[idx]!;
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          variantId: v.id,
          productNameSnapshot: v.productName,
          variantTitleSnapshot: v.sku,
          unitPriceMinor: v.priceMinor,
          quantity,
          lineTotalMinor: v.priceMinor * quantity,
          currency: "INR",
        },
      });
    }

    await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        orderId: order.id,
        provider: "DEMO",
        amountMinor: totalAmountMinor,
        currency: "INR",
        state: spec.paymentState,
        failureCategory: spec.failureCategory,
        failureCode: spec.failureCategory,
        createdAt,
        updatedAt: createdAt,
        capturedAt: spec.paymentState === "CAPTURED" ? createdAt : null,
      },
    });
  }

  console.log("[seed] creating agent action ledger demo events...");
  const workflowId = randomUUID();
  const ledgerRows: AppendLedgerEventParams[] = [
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "BUYER_AGENT",
      actionType: "DISCOVER_PRODUCT",
      status: "EXECUTED",
      conciseReason: "Matched buyer intent \"lightweight running shoes under ₹5000\" to Meridian Pulse Runner.",
      policyDecision: null,
      relatedEntityType: "Product",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: new Date(now - 6 * 60 * 60 * 1000),
    },
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "MERCHANT_AGENT",
      actionType: "PROPOSE_OFFER",
      status: "PROPOSED",
      conciseReason: "Proposed a ₹300 cross-sell discount on running socks to accompany the shoe purchase.",
      policyDecision: null,
      relatedEntityType: "Product",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: null,
    },
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "POLICY_ENGINE",
      actionType: "EVALUATE_OFFER",
      status: "APPROVED",
      conciseReason: "₹300 discount is within the merchant's configured ₹500 maximum discount — auto-allowed.",
      policyDecision: "ALLOW",
      relatedEntityType: "Order",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: new Date(now - 6 * 60 * 60 * 1000 + 60_000),
    },
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "SYSTEM",
      actionType: "CREATE_CHECKOUT",
      status: "EXECUTED",
      conciseReason: "Checkout created for the approved cart.",
      policyDecision: null,
      relatedEntityType: "Order",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: new Date(now - 6 * 60 * 60 * 1000 + 90_000),
    },
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "SYSTEM",
      actionType: "PAYMENT_FAILED",
      status: "FAILED",
      conciseReason: "Provider declined the card (CARD_DECLINED).",
      policyDecision: null,
      relatedEntityType: "Payment",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: new Date(now - 6 * 60 * 60 * 1000 + 120_000),
    },
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "MERCHANT_AGENT",
      actionType: "PROPOSE_RECOVERY",
      status: "APPROVED",
      conciseReason: "Proposed a single bounded retry on an alternate payment method.",
      policyDecision: "ALLOW",
      relatedEntityType: "Payment",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: new Date(now - 6 * 60 * 60 * 1000 + 150_000),
    },
    {
      workflowId,
      merchantId: merchant.id,
      actorType: "SYSTEM",
      actionType: "PAYMENT_CAPTURED",
      status: "VERIFIED",
      conciseReason: "Retried payment was captured and verified against provider-confirmed state.",
      policyDecision: null,
      relatedEntityType: "Payment",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: new Date(now - 6 * 60 * 60 * 1000 + 180_000),
    },
    {
      workflowId: randomUUID(),
      merchantId: merchant.id,
      actorType: "MERCHANT_AGENT",
      actionType: "PROPOSE_OFFER",
      status: "PENDING_APPROVAL",
      conciseReason: "Proposed a ₹1,200 loyalty discount, above the merchant's auto-approval threshold.",
      policyDecision: "REQUIRE_APPROVAL",
      relatedEntityType: "Order",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: null,
    },
    {
      workflowId: randomUUID(),
      merchantId: merchant.id,
      actorType: "MERCHANT_AGENT",
      actionType: "PROPOSE_OFFER",
      status: "REJECTED",
      conciseReason: "Proposed discount exceeded the merchant's maximum discount percentage — denied by policy.",
      policyDecision: "DENY",
      relatedEntityType: "Order",
      relatedEntityId: null,
      isSyntheticDemo: true,
      executedAt: null,
    },
  ];
  // PART 05 §65 — every ledger write, including seed demo data, goes
  // through the same centralized writer so the per-workflow hash chain is
  // never bypassed, even for synthetic data.
  for (const event of ledgerRows) {
    await appendLedgerEvent(prisma, event);
  }

  console.log("[seed] calculating readiness (previous snapshot, via the real deterministic engine)...");
  // PART 02 §125-§126 — both snapshots below are genuine
  // AgenticReadinessEngine outputs over real seeded data, never hand-picked
  // numbers. "Previous" reflects the catalog as seeded; then two small,
  // realistic merchant fixes are applied; "current" reflects that improved
  // state — so the delta shown in the UI is a real, traceable improvement.
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
  const previousAssessment = await runReadinessAssessment(prisma, merchant.id, fixedClock(twoDaysAgo.toISOString()));
  await prisma.readinessSnapshot.create({
    data: {
      merchantId: merchant.id,
      overallScore: previousAssessment.overallScore,
      level: previousAssessment.level,
      catalogCompleteness: previousAssessment.dimensions.catalogCompleteness,
      aiDiscoverability: previousAssessment.dimensions.aiDiscoverability,
      priceFreshness: previousAssessment.dimensions.priceFreshness,
      inventoryReliability: previousAssessment.dimensions.inventoryReliability,
      policyCompleteness: previousAssessment.dimensions.policyCompleteness,
      checkoutReadiness: previousAssessment.dimensions.checkoutReadiness,
      paymentReliability: previousAssessment.dimensions.paymentReliability,
      metadataQuality: previousAssessment.dimensions.metadataQuality,
      trustInformation: previousAssessment.dimensions.trustInformation,
      weakestDimension: previousAssessment.weakestDimension,
      strongestDimension: previousAssessment.strongestDimension,
      recommendations: previousAssessment.recommendations,
      blockers: previousAssessment.blockers as unknown as Prisma.InputJsonValue,
      strengths: previousAssessment.strengths,
      evidence: previousAssessment.evidence,
      calculationVersion: previousAssessment.calculationVersion,
      isSyntheticDemo: true,
      createdAt: twoDaysAgo,
    },
  });

  console.log("[seed] applying two realistic merchant fixes (promotion eligibility + inventory visibility)...");
  const productsWithUnknownEligibility = await prisma.product.findMany({
    where: { merchantId: merchant.id, promotionEligibility: "UNKNOWN" },
    take: 2,
    orderBy: { name: "asc" },
  });
  for (const product of productsWithUnknownEligibility) {
    await prisma.product.update({ where: { id: product.id }, data: { promotionEligibility: "ELIGIBLE" } });
  }
  const variantMissingInventory = await prisma.productVariant.findFirst({
    where: { product: { merchantId: merchant.id }, inventory: null, active: true },
    orderBy: { sku: "asc" },
  });
  if (variantMissingInventory) {
    await prisma.inventory.create({
      data: { variantId: variantMissingInventory.id, availableQuantity: int(5, 30) },
    });
  }

  console.log("[seed] calculating readiness (current snapshot)...");
  const currentAssessment = await runReadinessAssessment(prisma, merchant.id);
  const currentSnapshot = await prisma.readinessSnapshot.create({
    data: {
      merchantId: merchant.id,
      overallScore: currentAssessment.overallScore,
      level: currentAssessment.level,
      catalogCompleteness: currentAssessment.dimensions.catalogCompleteness,
      aiDiscoverability: currentAssessment.dimensions.aiDiscoverability,
      priceFreshness: currentAssessment.dimensions.priceFreshness,
      inventoryReliability: currentAssessment.dimensions.inventoryReliability,
      policyCompleteness: currentAssessment.dimensions.policyCompleteness,
      checkoutReadiness: currentAssessment.dimensions.checkoutReadiness,
      paymentReliability: currentAssessment.dimensions.paymentReliability,
      metadataQuality: currentAssessment.dimensions.metadataQuality,
      trustInformation: currentAssessment.dimensions.trustInformation,
      weakestDimension: currentAssessment.weakestDimension,
      strongestDimension: currentAssessment.strongestDimension,
      recommendations: currentAssessment.recommendations,
      blockers: currentAssessment.blockers as unknown as Prisma.InputJsonValue,
      strengths: currentAssessment.strengths,
      evidence: currentAssessment.evidence,
      calculationVersion: currentAssessment.calculationVersion,
      isSyntheticDemo: true,
    },
  });
  const overallScore = currentSnapshot.overallScore;
  const weakest = currentAssessment.weakestDimension;

  console.log("[seed] creating growth opportunities...");
  const lowStockVariant = [...allVariants].sort((a, b) => a.priceMinor - b.priceMinor)[0];
  await prisma.growthOpportunity.createMany({
    data: [
      {
        merchantId: merchant.id,
        category: "CROSS_SELL",
        signal: "Customers who buy running shoes rarely add running socks in the same order.",
        recommendation: "Surface a running-socks bundle offer at checkout when a shoe is added to cart.",
        estimatedValueMinor: 42_000,
        currency: "INR",
        valueClassification: "OPPORTUNITY",
        status: "IDENTIFIED",
        isSyntheticDemo: true,
      },
      {
        merchantId: merchant.id,
        category: "READINESS_GAP",
        signal: `${productsMissingPolicy.length} of ${PRODUCTS.length} products are missing structured return-policy and shipping information.`,
        recommendation: "Add return-policy and shipping summaries to the remaining products to improve Policy Completeness.",
        estimatedValueMinor: null,
        currency: null,
        valueClassification: "OPPORTUNITY",
        status: "IDENTIFIED",
        isSyntheticDemo: true,
      },
      {
        merchantId: merchant.id,
        category: "CATALOG_GAP",
        signal: lowStockVariant
          ? `Variant ${lowStockVariant.sku} has low visible inventory relative to recent demand.`
          : "A high-interest variant has low visible inventory.",
        recommendation: "Replenish inventory for high-interest, low-stock variants before they become agent-invisible.",
        estimatedValueMinor: null,
        currency: null,
        valueClassification: "OPPORTUNITY",
        status: "IDENTIFIED",
        isSyntheticDemo: true,
      },
      {
        merchantId: merchant.id,
        category: "PAYMENT_RECOVERY",
        signal: "3 recent checkouts failed at the payment step without a follow-up recovery attempt.",
        recommendation: "Enable bounded, policy-controlled recovery proposals for failed payments.",
        estimatedValueMinor: 128_000,
        currency: "INR",
        valueClassification: "ESTIMATED",
        status: "PROPOSED",
        isSyntheticDemo: true,
      },
    ],
  });

  console.log("[seed] creating merchant growth configuration + product relationships...");
  await prisma.merchantGrowthConfig.create({
    data: { merchantId: merchant.id },
  });

  // PART 04 §125-§130 — deterministic relationships supporting: a
  // cross-sell with multiple eligible candidates, a valid within-bounds
  // upsell, an invalid upsell that validation must reject (uplift far
  // exceeds the configured ceiling), a bundle, and a blocked opportunity
  // (a real complementary relationship to a product with forced UNKNOWN
  // inventory — the readiness -> growth connection, PART 04 §49-§51).
  const relationship = (source: string, target: string, relationshipType: "COMPLEMENTARY" | "UPSELL_ALTERNATIVE" | "BUNDLE_COMPATIBLE" | "SIMILAR") => {
    const sourceProductId = productsByName[source];
    const targetProductId = productsByName[target];
    if (!sourceProductId || !targetProductId) {
      throw new Error(`[seed] product relationship references an unknown product name: ${source} -> ${target}`);
    }
    return { merchantId: merchant.id, sourceProductId, targetProductId, relationshipType, provenance: "DEMO_SEED" as const };
  };

  await prisma.productRelationship.createMany({
    data: [
      relationship("Meridian Pulse Runner", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),
      relationship("Meridian Pulse Runner", "Meridian FlowFit Handheld Bottle", "COMPLEMENTARY"),
      relationship("Meridian Pulse Runner", "Meridian QuickBelt Hydration Belt", "COMPLEMENTARY"),
      relationship("Meridian Pulse Runner", "Meridian Aero Lightweight", "UPSELL_ALTERNATIVE"),
      relationship("Meridian Pulse Runner", "Meridian Velocity Racer", "UPSELL_ALTERNATIVE"),
      relationship("Meridian Pulse Runner", "Meridian Cushion Crew Socks", "BUNDLE_COMPATIBLE"),
      relationship("Meridian Summit Trail", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),
    ],
  });

  console.log("[seed] done.");
  console.log(`[seed] merchant: ${merchant.name} (${merchant.id})`);
  console.log(`[seed] products: ${PRODUCTS.length}, variants: ${allVariants.length}, customers: ${customers.length}`);
  console.log(
    `[seed] readiness overallScore=${overallScore} (was ${previousAssessment.overallScore}), weakest=${weakest}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
