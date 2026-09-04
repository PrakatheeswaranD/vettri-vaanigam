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
import { fixedClock, type PaymentFailureCategory } from "@razorgrowth/domain";
import { computeOrderFingerprint, ORDER_FINGERPRINT_VERSION } from "../src/modules/commerce/order-fingerprint.js";
import { runReadinessAssessment } from "../src/modules/readiness/engine.js";
import { appendLedgerEvent, type AppendLedgerEventParams } from "../src/modules/audit/ledger.js";
import { hashPassword } from "../src/modules/auth/password.js";

const prisma = new PrismaClient();

const MERCHANT_SLUG = "meridian-athletics";
/** PART 10 §1 — the one seeded, real, password-authenticated merchant
 * user for this demo merchant. A clearly-labeled demo credential, not a
 * secret — documented in `docs/DEMO.md` for local/demo use only. */
const DEMO_OWNER_EMAIL = "owner@meridianathletics.demo";
const DEMO_OWNER_PASSWORD = "MeridianDemo!2026";

/** A second, deliberately under-privileged account. It exists so the
 * RBAC boundary can be DEMONSTRATED rather than merely asserted: signing
 * in as this user and attempting to approve a proposal returns a real
 * 403 from `requireApprovalRole`, proving the approval gate is a server
 * rule and not a hidden button. */
const DEMO_VIEWER_EMAIL = "viewer@meridianathletics.demo";
const DEMO_VIEWER_PASSWORD = "MeridianViewer!2026";

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

/** Supabase/PgBouncer may recycle a connection during this intentionally
 * large demo seed. Retrying only connection-closure failures keeps the seed
 * robust without hiding validation, uniqueness, or integrity errors. */
async function withConnectionRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isClosedConnection =
        error instanceof Error && ("code" in error ? error.code === "P1017" : error.message.includes("closed the connection"));
      if (!isClosedConnection || attempt === 5) throw error;
      console.warn(`[seed] database connection recycled during ${label}; retrying (${attempt}/5)...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`[seed] unreachable retry state for ${label}`);
}

interface ProductSeed {
  name: string;
  category: string;
  description: string;
  sizes: readonly string[];
  basePriceMinor: number;
  includePolicyInfo: boolean;
  attributes?: Record<string, string>;
}

const CORE_PRODUCTS: ProductSeed[] = [
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

interface ProductRange {
  category: string;
  count: number;
  families: readonly string[];
  uses: readonly string[];
  sizes: readonly string[];
  basePriceMinor: number;
  priceStepMinor: number;
  attributes: readonly Record<string, string>[];
}

/** Category-specific product families produce varied, reproducible demo
 * data instead of hundreds of copied placeholder rows. The original core
 * products remain stable for golden-path tests and growth relationships. */
const PRODUCT_RANGES: readonly ProductRange[] = [
  { category: "Running Shoes", count: 40, families: ["Tempo", "Nimbus", "Stride", "Pace", "Glide", "Terra", "Aero", "Endure"], uses: ["daily road training", "race-day speed", "recovery mileage", "technical trails", "long-distance comfort"], sizes: ["UK6", "UK7", "UK8", "UK9", "UK10", "UK11"], basePriceMinor: 329900, priceStepMinor: 19000, attributes: [{ surface: "road", cushioning: "balanced" }, { surface: "road", weight: "lightweight" }, { surface: "trail", feature: "waterproof" }, { surface: "road", cushioning: "maximum" }] },
  { category: "Sportswear", count: 25, families: ["Motion Tee", "Core Shorts", "Storm Jacket", "Flex Leggings", "Thermal Layer"], uses: ["high-intensity training", "humid runs", "cold starts", "everyday recovery", "race warm-ups"], sizes: ["XS", "S", "M", "L", "XL"], basePriceMinor: 79900, priceStepMinor: 11000, attributes: [{ feature: "breathable" }, { weight: "lightweight" }, { feature: "wind-resistant" }, { feature: "quick-dry" }] },
  { category: "Socks", count: 15, families: ["Aero Sock", "Trail Crew", "Cushion Low", "Merino Run", "Race No-Show"], uses: ["blister resistance", "trail protection", "race-day ventilation", "long-run cushioning"], sizes: ["S/M", "L/XL"], basePriceMinor: 29900, priceStepMinor: 4500, attributes: [{ feature: "breathable" }, { cushioning: "maximum" }, { surface: "trail" }] },
  { category: "Hydration", count: 15, families: ["Flow Flask", "Endurance Vest", "Quick Belt", "Chill Bottle", "Race Cup"], uses: ["short training runs", "unsupported long runs", "race-day fueling", "temperature-controlled hydration"], sizes: ["One Size"], basePriceMinor: 59900, priceStepMinor: 17000, attributes: [{ capacity: "500ml", weight: "lightweight" }, { capacity: "750ml", feature: "insulated" }, { capacity: "1.5L", surface: "trail" }] },
  { category: "Accessories", count: 15, families: ["Night Band", "Aero Cap", "Grip Glove", "Race Belt", "Phone Arm"], uses: ["low-light visibility", "sun protection", "cold-weather control", "hands-free storage"], sizes: ["One Size"], basePriceMinor: 34900, priceStepMinor: 9000, attributes: [{ feature: "reflective" }, { weight: "lightweight" }, { feature: "touchscreen" }] },
  { category: "Walking Shoes", count: 15, families: ["City Walk", "Comfort Step", "Daily Ease", "Travel Glide", "Support Move"], uses: ["all-day commuting", "travel walking", "standing shifts", "casual recovery"], sizes: ["UK6", "UK7", "UK8", "UK9", "UK10", "UK11"], basePriceMinor: 249900, priceStepMinor: 16000, attributes: [{ surface: "road", cushioning: "maximum" }, { feature: "breathable", cushioning: "balanced" }, { feature: "water-resistant", support: "stability" }] },
  { category: "Training Shoes", count: 15, families: ["Lift Base", "Circuit Flex", "Gym Drive", "Court Move", "Cross Power"], uses: ["strength training", "functional fitness", "indoor court sessions", "mixed gym workouts"], sizes: ["UK6", "UK7", "UK8", "UK9", "UK10", "UK11"], basePriceMinor: 299900, priceStepMinor: 21000, attributes: [{ purpose: "strength", support: "stable" }, { purpose: "cross-training", weight: "lightweight" }, { purpose: "court", feature: "grippy" }] },
  { category: "Outdoor Gear", count: 15, families: ["Trail Shell", "Summit Pack", "Storm Light", "Trek Pole", "Base Camp"], uses: ["monsoon trails", "mountain day trips", "ultralight trekking", "technical hikes"], sizes: ["One Size"], basePriceMinor: 109900, priceStepMinor: 23000, attributes: [{ surface: "trail", feature: "waterproof" }, { surface: "trail", weight: "lightweight" }, { feature: "wind-resistant", durability: "rugged" }] },
  { category: "Recovery", count: 10, families: ["Restore Roller", "Mobility Ball", "Calf Sleeve", "Recovery Slide", "Massage Stick"], uses: ["post-run mobility", "muscle recovery", "travel recovery", "warm-up activation"], sizes: ["One Size"], basePriceMinor: 49900, priceStepMinor: 13000, attributes: [{ purpose: "recovery", firmness: "medium" }, { purpose: "mobility", weight: "lightweight" }, { purpose: "recovery", support: "compression" }] },
  { category: "Fitness Equipment", count: 10, families: ["Power Band", "Core Mat", "Speed Rope", "Balance Pad", "Kettle Bell"], uses: ["home strength sessions", "mobility training", "cardio conditioning", "balance work"], sizes: ["One Size"], basePriceMinor: 59900, priceStepMinor: 18000, attributes: [{ purpose: "strength", resistance: "medium" }, { purpose: "mobility", feature: "non-slip" }, { purpose: "cardio", weight: "lightweight" }] },
];

const GENERATED_PRODUCTS: ProductSeed[] = PRODUCT_RANGES.flatMap((range) =>
  Array.from({ length: range.count }, (_, index) => {
    const family = range.families[index % range.families.length]!;
    const use = range.uses[index % range.uses.length]!;
    const edition = Math.floor(index / range.families.length) + 1;
    return {
      name: `Meridian ${family} ${String(index + 1).padStart(2, "0")} E${edition}`,
      category: range.category,
      description: `${family} engineered for ${use}, with merchant-authored fit, availability and policy data for agent comparison.`,
      sizes: range.sizes,
      basePriceMinor: range.basePriceMinor + (index % 8) * range.priceStepMinor,
      includePolicyInfo: index % 9 !== 7,
      attributes: range.attributes[index % range.attributes.length],
    };
  }),
);

/**
 * Products whose promotion eligibility is a deliberate demo fact rather
 * than an output of the index rule further down. Every offer fixture in
 * this repo attaches its discount to Pulse Runner, so it has to be a
 * product this merchant actually permits promoting.
 */
const PROMOTABLE_HERO_PRODUCTS = new Set(["Meridian Pulse Runner"]);

const PRODUCTS: ProductSeed[] = [...CORE_PRODUCTS, ...GENERATED_PRODUCTS];

if (PRODUCTS.length !== 200) {
  throw new Error(`[seed] catalogue definition must contain exactly 200 products; found ${PRODUCTS.length}`);
}

// PART 03 §131 — the Buyer Agent demo scenario needs a real color
// attribute to filter on ("black running shoes"), not just size. Scoped to
// categories where color is a meaningful buying attribute, in a fixed
// deterministic rotation so the seed stays fully reproducible.
const COLORS_BY_CATEGORY: Record<string, readonly string[]> = {
  "Running Shoes": ["Black", "Grey", "Blue", "Red"],
  Sportswear: ["Black", "Grey", "Navy"],
  "Walking Shoes": ["Black", "White", "Grey", "Navy"],
  "Training Shoes": ["Black", "White", "Blue", "Red"],
  "Outdoor Gear": ["Black", "Navy", "Red"],
};

/**
 * Descriptive traits recorded as STRUCTURED attributes.
 *
 * Every value here is already asserted in the product's own description
 * ("Waterproof trail shoe", "Ultra-light training shoe") — this records
 * those same facts in a form an AI buyer can filter and rank on, rather
 * than leaving them buried in prose. Nothing is invented: a product
 * appears only where its description supports the trait.
 *
 * This closes a real gap. A buyer preference is matched BY KEY against
 * variant attributes, so before this the catalog stored only `color` and
 * `size` and a preference like "lightweight" or "waterproof" could never
 * match anything, no matter how well it was extracted. Making the catalog
 * machine-readable is the point of the product, and this is the catalog
 * side of it.
 */
const TRAITS_BY_PRODUCT: Record<string, Record<string, string>> = {
  "Meridian Pulse Runner": { surface: "road" },
  "Meridian Trailblaze GTX": { surface: "trail", feature: "waterproof" },
  "Meridian Velocity Racer": { surface: "road", weight: "lightweight" },
  "Meridian Cloudstep Comfort": { surface: "road", cushioning: "maximum" },
  "Meridian Summit Trail": { surface: "trail" },
  "Meridian Aero Lightweight": { surface: "road", weight: "lightweight" },
  "Meridian Windshield Jacket": { feature: "wind-resistant" },
  "Meridian Flex Shorts": { weight: "lightweight" },
  "Meridian CoolMax Running Socks": { feature: "breathable" },
  "Meridian Cushion Crew Socks": { cushioning: "maximum" },
  "Meridian Merino Trail Socks": { surface: "trail" },
  "Meridian InsulaFlask 750": { feature: "insulated" },
  "Meridian ReflectBand Armband": { feature: "reflective" },
  "Meridian AeroCap Running Hat": { weight: "lightweight" },
  "Meridian GripFit Gloves": { feature: "touchscreen" },
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

const MARKETPLACE_MERCHANTS = [
  { name: "TechNova", slug: "technova", priceMinor: 6_800_000, returnDays: 7, risk: "LOW", ram: "16GB", storage: "512GB", inventory: 12 },
  { name: "ByteStore", slug: "bytestore", priceMinor: 6_599_900, returnDays: 3, risk: "MEDIUM", ram: "16GB", storage: "512GB", inventory: 7 },
  { name: "ElectroHub", slug: "electrohub", priceMinor: 6_950_000, returnDays: 7, risk: "LOW", ram: "8GB", storage: "1TB", inventory: 0 },
] as const;

/** Track 01 marketplace fixtures: deliberately small, merchant-authored
 * catalogs used by the Buyer Agent comparison demo. These are isolated
 * demo merchants, never copied into Meridian's private merchant console. */
async function seedMarketplaceMerchants() {
  for (const fixture of MARKETPLACE_MERCHANTS) {
    // Marketplace fixtures can acquire orders, payments, conversations and
    // recommendations during integration tests. Reset the complete merchant
    // dependency graph instead of deleting Product directly through live FKs.
    await resetDemoMerchant(fixture.slug);
    const marketplaceMerchant = await prisma.merchant.create({
      data: {
        name: fixture.name,
        slug: fixture.slug,
        description: `${fixture.name} is a synthetic AI-ready marketplace merchant for multi-merchant discovery demos.`,
        defaultCurrency: "INR",
        businessCategory: "Electronics & Computers",
        status: "ACTIVE",
      },
    });
    await prisma.merchantPolicy.upsert({
      where: { merchantId: marketplaceMerchant.id },
      update: {},
      create: {
        merchantId: marketplaceMerchant.id,
        policyVersion: 1,
        currency: "INR",
        maxDiscountBps: 500,
        autoApprovalDiscountBps: 200,
        maxOrderAmountMinor: 10_000_000,
        autoApprovalOrderAmountMinor: 200_000,
        maxRecoveryAttempts: 1,
        proposalValidityMinutes: 30,
        approvalValidityMinutes: 15,
        authorizationValidityMinutes: 10,
      },
    });
    const laptop = await prisma.product.create({
      data: {
        merchantId: marketplaceMerchant.id,
        name: `${fixture.name} ThinkBook X`,
        slug: "thinkbook-x",
        description: "Developer laptop with structured specifications, shipping, returns, and agentic checkout support.",
        category: "Electronics/Laptop",
        brand: "ThinkBook",
        status: "ACTIVE",
        returnPolicySummary: `Returns accepted within ${fixture.returnDays} days in original condition.`,
        shippingSummary: "Ships in 1–2 business days with tracked delivery.",
        promotionEligibility: "ELIGIBLE",
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: laptop.id,
        sku: `${fixture.slug.toUpperCase()}-TBX-01`,
        title: `ThinkBook X — ${fixture.ram} / ${fixture.storage}`,
        priceMinor: fixture.priceMinor,
        costMinor: Math.floor(fixture.priceMinor * 0.82),
        currency: "INR",
        attributes: { ram: fixture.ram, storage: fixture.storage, purpose: "software_development", risk: fixture.risk, processor: "Intel Core Ultra 7" },
        active: true,
        inventory: { create: { availableQuantity: fixture.inventory } },
      },
    });
  }
}

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
  // Conversations belong to the SHOPPER, not to this merchant, so they
  // cannot be deleted "by merchant". What ties one to this merchant is the
  // recommendation it produced — so the conversations cleared here are the
  // ones that recommended this catalogue, which is about to be rebuilt
  // with new product ids. Both must be found BEFORE the recommendation
  // rows they are found through are deleted.
  const staleConversationIds = (
    await prisma.buyerConversation.findMany({
      where: { recommendations: { some: { merchantId } } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.recommendationRecord.deleteMany({ where: { merchantId } });
  await prisma.buyerMessage.deleteMany({ where: { conversationId: { in: staleConversationIds } } });
  await prisma.buyerConversation.deleteMany({ where: { id: { in: staleConversationIds } } });
  await prisma.orderItem.deleteMany({ where: { order: { merchantId } } });
  await prisma.order.deleteMany({ where: { merchantId } });
  await prisma.cartItem.deleteMany({ where: { cart: { merchantId } } });
  await prisma.cart.deleteMany({ where: { merchantId } });
  await prisma.agentAction.deleteMany({ where: { merchantId } });
  await prisma.readinessSnapshot.deleteMany({ where: { merchantId } });
  await prisma.inventory.deleteMany({ where: { variant: { product: { merchantId } } } });
  await prisma.productVariant.deleteMany({ where: { product: { merchantId } } });
  await prisma.product.deleteMany({ where: { merchantId } });
  await prisma.customer.deleteMany({ where: { merchantId } });
  await prisma.merchantPolicy.deleteMany({ where: { merchantId } });
  // PART 10 §1 — MerchantUser must be deleted AFTER growthActionProposal
  // (line above), since deleting a proposal cascades to its Approval row,
  // and Approval.approverId RESTRICTs deletion of the MerchantUser it
  // references. Session cascades from MerchantUser, so no separate step
  // is needed for it.
  await prisma.merchantUser.deleteMany({ where: { merchantId } });
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

  console.log("[seed] creating merchant owner account...");
  /** The demo shopper's account id, needed further down for their policy. */
  let customerAccountId: string | null = null;
  for (const identity of [
    { slug: "demo-customer-context", name: "Demo Customer", email: "customer@vaanigam.demo", role: "CUSTOMER" as const, password: "CustomerDemo!2026" },
    { slug: "demo-platform-context", name: "Platform Administration", email: "admin@vaanigam.demo", role: "PLATFORM_ADMIN" as const, password: "AdminDemo!2026" },
  ]) {
    const context = await prisma.merchant.upsert({ where: { slug: identity.slug }, update: {}, create: { slug: identity.slug, name: identity.name, defaultCurrency: "INR", businessCategory: "Identity context", status: "ACTIVE" } });
    // A shopper gets a real CustomerAccount, and it takes the identity
    // context's id deliberately: `DecisionRecord.protocolActorRef` is a
    // free-form actor reference with no foreign key and already holds that
    // value on every historical purchase. Same id, so nothing has to be
    // rewritten and the two can never disagree.
    if (identity.role === "CUSTOMER") {
      await prisma.customerAccount.upsert({
        where: { id: context.id },
        update: { displayName: identity.name },
        create: { id: context.id, displayName: identity.name },
      });
      customerAccountId = context.id;
    }
    await prisma.merchantUser.upsert({
      where: { email: identity.email },
      update: { role: identity.role, merchantId: context.id, customerAccountId: identity.role === "CUSTOMER" ? context.id : null, passwordHash: await hashPassword(identity.password) },
      create: { merchantId: context.id, customerAccountId: identity.role === "CUSTOMER" ? context.id : null, email: identity.email, role: identity.role, passwordHash: await hashPassword(identity.password) },
    });
  }
  if (!customerAccountId) throw new Error("[seed] the demo CUSTOMER identity did not produce a customer account.");
  await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: DEMO_OWNER_EMAIL,
      passwordHash: await hashPassword(DEMO_OWNER_PASSWORD),
      role: "OWNER",
    },
  });
  await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: DEMO_VIEWER_EMAIL,
      passwordHash: await hashPassword(DEMO_VIEWER_PASSWORD),
      role: "VIEWER",
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
  const productRows: Prisma.ProductCreateManyInput[] = [];
  const variantRows: Prisma.ProductVariantCreateManyInput[] = [];
  const inventoryRows: Prisma.InventoryCreateManyInput[] = [];
  let globalVariantIndex = 0;

  for (const [productIndex, p] of PRODUCTS.entries()) {
    const slug = slugify(p.name);
    // Roughly a third ELIGIBLE, one in seven INELIGIBLE, the rest left at
    // the UNKNOWN default — a merchant that hasn't decided is realistic,
    // not an oversight (PART 02 §57, §9).
    //
    // PART 15 — except that an index rule must not decide the eligibility
    // of the product the whole demo hangs on. Pulse Runner is the buyer's
    // worked example ("lightweight running shoes under ₹5000"), the
    // relationship graph's hub, and the product every offer fixture
    // attaches a discount to — and `0 % 7 === 0` marked it INELIGIBLE.
    //
    // Nothing enforced that, so the contradiction was invisible: buyers
    // were quoted merchant-authorized discounts on a product its merchant
    // had excluded from promotion. Now that `findBuyerVisibleOffers`
    // honours the flag, the seed has to mean what it says.
    const promotionEligibility = PROMOTABLE_HERO_PRODUCTS.has(p.name)
      ? "ELIGIBLE"
      : productIndex % 7 === 0
        ? "INELIGIBLE"
        : productIndex % 3 === 0
          ? "ELIGIBLE"
          : undefined;

    const productId = randomUUID();
    productRows.push({
      id: productId,
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
    });
    if (!p.includePolicyInfo) productsMissingPolicy.push(p.name);
    productsByName[p.name] = productId;

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

      // Every 13th variant: discontinued (inactive) — EXCEPT when the
      // product has only one variant. Deactivating a single-variant
      // product's only variant leaves an ACTIVE product with no
      // purchasable variant and therefore no price, which the growth
      // engine correctly reports as MISSING_PRICE. That is a data-quality
      // bug, not realistic merchant behaviour: a merchant discontinuing
      // their only variant would archive the product too. It made
      // "Meridian AeroCap Running Hat" permanently unsellable and blocked
      // every relationship pointing at it.
      const isActive = p.sizes.length === 1 ? true : globalVariantIndex % 13 !== 6;

      const colors = COLORS_BY_CATEGORY[p.category];
      const color = colors ? pick(colors) : null;

      const variantId = randomUUID();
      variantRows.push({
        id: variantId,
        productId,
        sku,
        title: `${p.name} — ${size}${color ? ` (${color})` : ""}`,
        priceMinor,
        // Synthetic but explicit demo COGS. Real merchants must import
        // their own unit cost; absent cost remains NULL and disables
        // negotiated discounts rather than pretending sale price is margin.
        costMinor: Math.floor(priceMinor * 0.65),
        currency: "INR",
        attributes: hasAttributes ? { size, ...(color ? { color } : {}), ...(TRAITS_BY_PRODUCT[p.name] ?? {}), ...(p.attributes ?? {}) } : {},
        active: isActive,
        priceUpdatedAt,
      });

      // Every 8th variant: inventory has never been recorded at all — a
      // real UNKNOWN state (PART 02 §9), not a fabricated "in stock").
      // Forced additionally for the PART 04 blocked-opportunity demo product.
      const hasKnownInventory = globalVariantIndex % 8 !== 3 && !PRODUCTS_WITH_FORCED_UNKNOWN_INVENTORY.has(p.name);
      if (hasKnownInventory) {
        // Stock levels are now REAL: checkout reserves and decrements them
        // inside the transaction, so a seeded 0-40 units was exhausted part
        // way through a full test run and later checkouts started failing
        // for want of stock rather than for the reason under test.
        //
        // Some variants are still deliberately ZERO, because a genuinely
        // out-of-stock product is evidence the readiness engine needs and
        // removing it would flatter the score.
        //
        // Running Shoes are excluded: they are the category every buyer-agent
        // fixture searches ("black size-9 under ₹6,000"), and zeroing one
        // silently turned a golden-path match into NO_MATCH. Out-of-stock
        // evidence comes from the other four categories instead, so the
        // signal survives without breaking the demo it is meant to describe.
        const deliberatelyOutOfStock = p.category !== "Running Shoes" && globalVariantIndex % 9 === 5;
        const availableQuantity = deliberatelyOutOfStock ? 0 : int(500, 900);
        inventoryRows.push({ variantId, availableQuantity, updatedAt: priceUpdatedAt });
      }

      allVariants.push({ id: variantId, priceMinor, sku, productName: p.name });
      globalVariantIndex++;
    }
  }

  // Three bounded database round-trips replace thousands of sequential
  // writes. IDs are generated above so every dependent row remains fully
  // deterministic within this run and historical-order seeding can reuse
  // the exact variant identities.
  await withConnectionRetry(() => prisma.product.createMany({ data: productRows }), "product batch");
  await withConnectionRetry(() => prisma.productVariant.createMany({ data: variantRows }), "variant batch");
  await withConnectionRetry(() => prisma.inventory.createMany({ data: inventoryRows }), "inventory batch");

  console.log("[seed] creating historical orders + payments...");
  /**
   * `failureCode` is the raw, provider-shaped string a merchant would see
   * in a gateway dashboard. `failureCategory` is the NORMALIZED value from
   * `@razorgrowth/domain`'s closed `PAYMENT_FAILURE_CATEGORIES` taxonomy.
   *
   * These were previously the same string, which meant the database held
   * categories (`CARD_DECLINED`, `BANK_TIMEOUT`) that are not members of
   * the taxonomy at all. Anything reading `failureCategory` as a domain
   * value — recovery eligibility above all — silently fell through to its
   * "category unknown" branch and skipped the retryability check, so a
   * bank timeout looked exactly as recoverable as a declined card.
   *
   * With the taxonomy applied, `TIMEOUT_UNKNOWN` is correctly NOT
   * retryable (an unverified outcome must be reconciled, never retried
   * blind), so the timeout row is now excluded from recovery — which is
   * the whole point of having the taxonomy.
   */
  const orderSpecs: {
    status: "PAID" | "FAILED" | "PENDING";
    paymentState: "CAPTURED" | "FAILED" | "CREATED";
    failureCode: string | null;
    failureCategory: PaymentFailureCategory | null;
  }[] = [
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "PAID", paymentState: "CAPTURED", failureCode: null, failureCategory: null },
    { status: "FAILED", paymentState: "FAILED", failureCode: "CARD_DECLINED", failureCategory: "PAYMENT_DECLINED" },
    { status: "FAILED", paymentState: "FAILED", failureCode: "INSUFFICIENT_FUNDS", failureCategory: "INSUFFICIENT_FUNDS" },
    { status: "FAILED", paymentState: "FAILED", failureCode: "BANK_TIMEOUT", failureCategory: "TIMEOUT_UNKNOWN" },
    { status: "PENDING", paymentState: "CREATED", failureCode: null, failureCategory: null },
    { status: "PENDING", paymentState: "CREATED", failureCode: null, failureCategory: null },
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

    /**
     * A Cart and CheckoutSession for every order.
     *
     * These used to be omitted: seed orders jumped straight to a Payment
     * with `checkoutId: null`. That produced data no real code path can
     * produce, and it broke the thing the demo most needs to work —
     * `evaluateAndProposeRecovery` refuses outright with "no checkout
     * session exists for this payment", so every failed payment in the
     * seed was permanently unrecoverable. The fingerprint is computed with
     * the SAME function commerce execution uses, not a placeholder string,
     * so verification against it behaves identically to a live order.
     */
    const cart = await prisma.cart.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: spec.status === "PAID" ? "CONVERTED" : "CHECKOUT_PENDING",
        currency: "INR",
        createdAt,
        updatedAt: createdAt,
        items: {
          create: chosenVariants.map((v, idx) => ({
            variantId: v.id,
            quantity: quantities[idx]!,
            unitPriceMinor: v.priceMinor,
            currency: "INR" as const,
            createdAt,
          })),
        },
      },
    });

    const orderFingerprint = computeOrderFingerprint({
      orderId: order.id,
      merchantId: merchant.id,
      currency: "INR",
      totalAmountMinor,
      // Seeded orders are direct buyer purchases with no agent
      // authorization behind them; the fingerprint records that honestly
      // rather than inventing an authorization id.
      authorizationId: "",
      lines: chosenVariants.map((v, idx) => ({
        variantId: v.id,
        quantity: quantities[idx]!,
        unitPriceMinor: v.priceMinor,
        lineDiscountMinor: 0,
        lineTotalMinor: v.priceMinor * quantities[idx]!,
      })),
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { orderFingerprint, fingerprintVersion: ORDER_FINGERPRINT_VERSION },
    });

    const checkout = await prisma.checkoutSession.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        cartId: cart.id,
        orderId: order.id,
        status:
          spec.paymentState === "CAPTURED" ? "COMPLETED" : spec.paymentState === "FAILED" ? "FAILED" : "PAYMENT_IN_PROGRESS",
        amountMinor: totalAmountMinor,
        currency: "INR",
        orderFingerprint,
        fingerprintVersion: ORDER_FINGERPRINT_VERSION,
        workflowId: randomUUID(),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 30 * 60 * 1000),
      },
    });

    await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        orderId: order.id,
        checkoutId: checkout.id,
        provider: "DEMO",
        amountMinor: totalAmountMinor,
        currency: "INR",
        state: spec.paymentState,
        // A timeout is the one failure where the customer may genuinely
        // have been debited despite the merchant never being credited —
        // which is exactly why it is not retryable without reconciling.
        customerDebitStatus: spec.paymentState === "CAPTURED" ? "DEBITED" : spec.failureCategory === "TIMEOUT_UNKNOWN" ? "DEBITED" : "UNKNOWN",
        merchantCreditStatus: spec.paymentState === "CAPTURED" ? "CREDITED" : spec.paymentState === "FAILED" ? "NOT_CREDITED" : "UNKNOWN",
        automaticRetryBlocked: spec.paymentState === "FAILED",
        failureCategory: spec.failureCategory,
        failureCode: spec.failureCode,
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

  // Coverage matters here, not just the scripted cases. With only the six
  // Pulse Runner rows plus one Summit Trail row, 23 of 25 products
  // returned NO_OPPORTUNITY ("no relevant growth candidate") — so anyone
  // exploring the catalog hit a dead end ~92% of the time, and the
  // Merchant Agent looked broken when it was in fact correct and simply
  // had nothing to reason over.
  //
  // Every product below therefore has at least two outgoing
  // relationships, modelled on how this catalog actually fits together:
  // shoes pair with socks/hydration/accessories, apparel bundles with
  // apparel, and same-category items ladder upward in price.
  //
  // UPSELL_ALTERNATIVE rows are deliberately kept inside
  // `maxUpsellIncreaseBps` (1500 = 15%) so they survive validation — with
  // ONE intentional exception, Pulse Runner -> Velocity Racer (+78%),
  // retained from the original seed because PART 04 §125-§130 wants a
  // real over-ceiling upsell that deterministic validation must reject.
  //
  // Pulse Runner -> QuickBelt (COMPLEMENTARY) is likewise retained: the
  // belt has forced UNKNOWN inventory, so it demonstrates the
  // readiness -> growth link (a genuine relationship blocked by missing
  // commerce data) rather than being quietly dropped.
  await prisma.productRelationship.createMany({
    data: [
      // --- Running shoes: pair with socks, hydration, accessories -----
      relationship("Meridian Cloudstep Comfort", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),
      relationship("Meridian Cloudstep Comfort", "Meridian FlowFit Handheld Bottle", "COMPLEMENTARY"),
      relationship("Meridian Cloudstep Comfort", "Meridian StrideLace Kit", "COMPLEMENTARY"),
      relationship("Meridian Cloudstep Comfort", "Meridian Pulse Runner", "UPSELL_ALTERNATIVE"), // +4.7%

      relationship("Meridian Pulse Runner", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),
      relationship("Meridian Pulse Runner", "Meridian FlowFit Handheld Bottle", "COMPLEMENTARY"),
      relationship("Meridian Pulse Runner", "Meridian QuickBelt Hydration Belt", "COMPLEMENTARY"), // blocked-by-data case
      relationship("Meridian Pulse Runner", "Meridian Aero Lightweight", "UPSELL_ALTERNATIVE"), // +4.4%
      relationship("Meridian Pulse Runner", "Meridian Velocity Racer", "UPSELL_ALTERNATIVE"), // +78% — must be rejected
      relationship("Meridian Pulse Runner", "Meridian Cushion Crew Socks", "BUNDLE_COMPATIBLE"),

      relationship("Meridian Aero Lightweight", "Meridian No-Show Performance Socks", "COMPLEMENTARY"),
      relationship("Meridian Aero Lightweight", "Meridian InsulaFlask 750", "COMPLEMENTARY"),
      relationship("Meridian Aero Lightweight", "Meridian AeroCap Running Hat", "COMPLEMENTARY"),
      relationship("Meridian Aero Lightweight", "Meridian Cushion Crew Socks", "BUNDLE_COMPATIBLE"),

      relationship("Meridian Trailblaze GTX", "Meridian Merino Trail Socks", "COMPLEMENTARY"),
      relationship("Meridian Trailblaze GTX", "Meridian TrailPack Hydration Vest", "COMPLEMENTARY"),
      relationship("Meridian Trailblaze GTX", "Meridian GripFit Gloves", "COMPLEMENTARY"),
      relationship("Meridian Trailblaze GTX", "Meridian Summit Trail", "UPSELL_ALTERNATIVE"), // +5.4%

      relationship("Meridian Summit Trail", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),
      relationship("Meridian Summit Trail", "Meridian Merino Trail Socks", "COMPLEMENTARY"),
      relationship("Meridian Summit Trail", "Meridian TrailPack Hydration Vest", "COMPLEMENTARY"),
      relationship("Meridian Summit Trail", "Meridian ReflectBand Armband", "COMPLEMENTARY"),

      relationship("Meridian Velocity Racer", "Meridian No-Show Performance Socks", "COMPLEMENTARY"),
      relationship("Meridian Velocity Racer", "Meridian FlowFit Handheld Bottle", "COMPLEMENTARY"),
      relationship("Meridian Velocity Racer", "Meridian PulseTrack Chest Strap", "COMPLEMENTARY"),

      // --- Socks: pair back to shoes and apparel ---------------------
      relationship("Meridian No-Show Performance Socks", "Meridian Cloudstep Comfort", "COMPLEMENTARY"),
      relationship("Meridian No-Show Performance Socks", "Meridian DriFit Training Tee", "COMPLEMENTARY"),
      relationship("Meridian No-Show Performance Socks", "Meridian CoolMax Running Socks", "UPSELL_ALTERNATIVE"), // +14.0%

      relationship("Meridian CoolMax Running Socks", "Meridian Pulse Runner", "COMPLEMENTARY"),
      relationship("Meridian CoolMax Running Socks", "Meridian Flex Shorts", "COMPLEMENTARY"),
      relationship("Meridian CoolMax Running Socks", "Meridian Cushion Crew Socks", "UPSELL_ALTERNATIVE"), // +12.5%

      relationship("Meridian Cushion Crew Socks", "Meridian Aero Lightweight", "COMPLEMENTARY"),
      relationship("Meridian Cushion Crew Socks", "Meridian Compression Base Layer", "COMPLEMENTARY"),

      relationship("Meridian Merino Trail Socks", "Meridian Trailblaze GTX", "COMPLEMENTARY"),
      relationship("Meridian Merino Trail Socks", "Meridian ThermaCore Half-Zip", "COMPLEMENTARY"),

      // --- Hydration -------------------------------------------------
      relationship("Meridian FlowFit Handheld Bottle", "Meridian Pulse Runner", "COMPLEMENTARY"),
      relationship("Meridian FlowFit Handheld Bottle", "Meridian AeroCap Running Hat", "COMPLEMENTARY"),

      relationship("Meridian InsulaFlask 750", "Meridian Trailblaze GTX", "COMPLEMENTARY"),
      relationship("Meridian InsulaFlask 750", "Meridian FlowFit Handheld Bottle", "COMPLEMENTARY"),
      relationship("Meridian InsulaFlask 750", "Meridian QuickBelt Hydration Belt", "UPSELL_ALTERNATIVE"), // +8.4%

      relationship("Meridian QuickBelt Hydration Belt", "Meridian Trailblaze GTX", "COMPLEMENTARY"),
      relationship("Meridian QuickBelt Hydration Belt", "Meridian ReflectBand Armband", "COMPLEMENTARY"),

      relationship("Meridian TrailPack Hydration Vest", "Meridian Summit Trail", "COMPLEMENTARY"),
      relationship("Meridian TrailPack Hydration Vest", "Meridian Cushion Crew Socks", "COMPLEMENTARY"),
      relationship("Meridian TrailPack Hydration Vest", "Meridian Trailblaze GTX", "COMPLEMENTARY"),

      // --- Accessories -----------------------------------------------
      relationship("Meridian StrideLace Kit", "Meridian Cloudstep Comfort", "COMPLEMENTARY"),
      relationship("Meridian StrideLace Kit", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),

      relationship("Meridian ReflectBand Armband", "Meridian Windshield Jacket", "COMPLEMENTARY"),
      relationship("Meridian ReflectBand Armband", "Meridian ThermaCore Half-Zip", "COMPLEMENTARY"),

      relationship("Meridian AeroCap Running Hat", "Meridian DriFit Training Tee", "COMPLEMENTARY"),
      relationship("Meridian AeroCap Running Hat", "Meridian StrideLace Kit", "COMPLEMENTARY"),

      relationship("Meridian GripFit Gloves", "Meridian ThermaCore Half-Zip", "COMPLEMENTARY"),
      relationship("Meridian GripFit Gloves", "Meridian Windshield Jacket", "COMPLEMENTARY"),

      relationship("Meridian PulseTrack Chest Strap", "Meridian Compression Base Layer", "COMPLEMENTARY"),
      relationship("Meridian PulseTrack Chest Strap", "Meridian Velocity Racer", "COMPLEMENTARY"),

      // --- Sportswear ------------------------------------------------
      relationship("Meridian DriFit Training Tee", "Meridian Cushion Crew Socks", "COMPLEMENTARY"),
      relationship("Meridian DriFit Training Tee", "Meridian Cloudstep Comfort", "COMPLEMENTARY"),
      relationship("Meridian DriFit Training Tee", "Meridian Flex Shorts", "BUNDLE_COMPATIBLE"),

      relationship("Meridian Flex Shorts", "Meridian CoolMax Running Socks", "COMPLEMENTARY"),
      relationship("Meridian Flex Shorts", "Meridian DriFit Training Tee", "BUNDLE_COMPATIBLE"),
      relationship("Meridian Flex Shorts", "Meridian Compression Base Layer", "UPSELL_ALTERNATIVE"), // +14.2%

      relationship("Meridian Compression Base Layer", "Meridian ThermaCore Half-Zip", "COMPLEMENTARY"),
      relationship("Meridian Compression Base Layer", "Meridian Momentum Leggings", "UPSELL_ALTERNATIVE"), // +12.5%

      relationship("Meridian Momentum Leggings", "Meridian ThermaCore Half-Zip", "COMPLEMENTARY"),
      relationship("Meridian Momentum Leggings", "Meridian Merino Trail Socks", "COMPLEMENTARY"),

      relationship("Meridian ThermaCore Half-Zip", "Meridian Cushion Crew Socks", "COMPLEMENTARY"),
      relationship("Meridian ThermaCore Half-Zip", "Meridian Windshield Jacket", "UPSELL_ALTERNATIVE"), // +8.7%

      relationship("Meridian Windshield Jacket", "Meridian ReflectBand Armband", "COMPLEMENTARY"),
      relationship("Meridian Windshield Jacket", "Meridian ThermaCore Half-Zip", "COMPLEMENTARY"),
    ],
  });
  // The SHOPPER's policy, not the seller's. This was created with
  // `merchantId: merchant.id` — a buyer spending policy belonging to a
  // merchant, which no shopper could ever have used and no route could
  // ever have read, because /buyer/* is closed to merchant sessions.
  //
  // An UPSERT, not a create. The reset at the top of this seed clears the
  // demo MERCHANT's rows; this policy belongs to the demo SHOPPER, who
  // survives a merchant reset, so a second seed run would collide on the
  // unique customer account. Re-running the seed has to stay idempotent.
  const seededCategories = (
    await prisma.product.findMany({ where: { merchantId: merchant.id, status: "ACTIVE" }, select: { category: true }, distinct: ["category"] })
  ).map((row) => row.category);
  const shopperPolicy = {
    currency: "INR" as const,
    autonomousPurchaseLimitMinor: 200_000,
    dailyLimitMinor: 1_000_000,
    // Derived from the catalogue this seed just created, not a fixed
    // list. The old literal named three categories no merchant here
    // stocks, so it only ever worked because "Running Shoes" had been
    // bolted onto it — and it would silently start declining purchases
    // again the moment the demo catalogue changed.
    allowedCategories: seededCategories,
    approvalRequiredAboveLimit: true,
  };
  await prisma.buyerSpendingPolicy.upsert({
    where: { customerAccountId },
    update: shopperPolicy,
    create: { customerAccountId, ...shopperPolicy },
  });

  console.log("[seed] creating multi-merchant AI discovery fixtures...");
  await seedMarketplaceMerchants();

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
