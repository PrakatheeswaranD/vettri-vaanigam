/**
 * Internal specialist manifest (Part 11 §47).
 *
 * A single typed description of what the merchant-facing "AI Growth &
 * Agentic Commerce" capability observes, may propose, and may never do.
 * It exists so the product surface (Capabilities, Agent Authority,
 * Business Triggers) and the docs read from ONE declaration instead of
 * three hand-maintained lists that can silently drift apart.
 *
 * IMPORTANT — scope of this file:
 *
 *  - This is an INTERNAL product abstraction. It is NOT Razorpay Agent
 *    Studio's manifest format, and nothing in this repository is
 *    registered with, certified by, or integrated into Agent Studio.
 *  - It is DESCRIPTIVE, not an enforcement mechanism. `prohibited` does
 *    not gate anything at runtime; those boundaries are enforced
 *    structurally by the real code paths (the agents never call the
 *    payment gateway or `decideApproval`; `approverId` always comes from
 *    the authenticated session; capture is only ever written from
 *    verified provider evidence). This list documents that architecture
 *    so a merchant can see it — it must never be mistaken for the
 *    control that implements it.
 */

/**
 * The named AI specialists in this build.
 *
 * There are exactly THREE, and each is a real, separate `AIProvider`
 * method — not three names for one prompt:
 *
 *   Buyer Agent    → `extractIntent` / `rankCandidates`
 *   Merchant Agent → `proposeGrowthAction` / `proposeRecoveryAction`
 *   Catalog Agent  → `normalizeCatalogRow`
 *
 * The Catalog Agent was the last to be named, and naming it changed no
 * code: it was already the third AI touchpoint, doing the one job a rules
 * engine genuinely cannot (reading `"500ml combo of 2 — festive offer!!"`
 * out of a real merchant export). Leaving it unnamed meant the product
 * surface claimed two specialists while the code had three, which anyone
 * reading the source would notice.
 *
 * Each is single-purpose and bounded. None of them can approve, price,
 * discount, or move money — that is deterministic code's job, always.
 */
export const AI_SPECIALISTS = [
  {
    id: "buyer_agent",
    name: "Buyer Agent",
    purpose: "Reads a shopper's words and turns them into structured, checkable constraints.",
    aiMethod: "extractIntent / rankCandidates",
    boundary: "It may interpret and rank. It may never invent a product, set a price, or decide availability.",
  },
  {
    id: "merchant_agent",
    name: "Merchant Agent",
    purpose: "Proposes bounded cross-sell, upsell and payment-recovery actions.",
    aiMethod: "proposeGrowthAction / proposeRecoveryAction",
    boundary: "It may propose. Policy decides, a human approves, and deterministic code executes.",
  },
  {
    id: "catalog_agent",
    name: "Catalog Agent",
    purpose: "Reads messy merchant export rows and extracts structured product fields.",
    aiMethod: "normalizeCatalogRow",
    boundary:
      "It may read and structure. It refuses to invent: an unreadable field is reported as an issue against that row, never guessed — and nothing it produces goes live until a human publishes it.",
  },
] as const;

export type AiSpecialist = (typeof AI_SPECIALISTS)[number];

/** Business events that cause the specialist to do work (§24-§27). These
 * name real entry points that already exist in this build. */
export const SPECIALIST_TRIGGERS = [
  {
    id: "buyer.intent.created",
    label: "Buyer intent created",
    description: "A buyer describes what they want; the Buyer Agent extracts structured intent.",
    entryPoint: "Buyer Agent → structured intent → deterministic catalog filter → grounded recommendation",
  },
  {
    id: "product.selected",
    label: "Product selected",
    description: "A buyer selects a product; the Merchant Agent looks for a legitimate growth opportunity.",
    entryPoint: "Merchant Agent → growth proposal → validation → policy",
  },
  {
    id: "catalog.row.received",
    label: "Catalogue row received",
    description:
      "A merchant uploads a raw export. The Catalog Agent reads each row and extracts structured fields, reporting anything it cannot read rather than guessing.",
    entryPoint: "Catalog Agent → normalized draft → merchant review → explicit publish → live catalogue",
  },
  {
    id: "payment.failed",
    label: "Payment failed",
    description:
      "A payment attempt fails. Failure is normalized deterministically first — the agent only ever receives safe, normalized facts, never the raw provider payload.",
    entryPoint: "Failure normalization → recovery eligibility → recovery proposal → policy → bounded retry",
  },
] as const;

/** What the specialist may do. Each maps to a capability this build
 * actually implements — nothing aspirational is listed. */
export const SPECIALIST_CAPABILITIES = [
  "catalog.read",
  "inventory.read",
  "buyer_intent.read",
  "recommendation.create",
  "growth.cross_sell.propose",
  "growth.upsell.propose",
  "growth.bundle.propose",
  "growth.offer.propose",
  "payment.recovery.propose",
] as const;

/** What the specialist can never do. Enforced by architecture, not by
 * this list — see the file header. */
export const SPECIALIST_PROHIBITED = [
  "approval.self_approve",
  "policy.override",
  "discount.execute_directly",
  "payment.mark_captured",
  "payment.override_state",
  "payment.retry_unbounded",
] as const;

export const SPECIALIST_MANIFEST = {
  id: "ai-growth-agentic-commerce",
  name: "AI Growth & Agentic Commerce",
  version: "1.0.0",
  specialists: AI_SPECIALISTS,
  triggers: SPECIALIST_TRIGGERS,
  capabilities: SPECIALIST_CAPABILITIES,
  prohibited: SPECIALIST_PROHIBITED,
} as const;

export type SpecialistTrigger = (typeof SPECIALIST_TRIGGERS)[number];
