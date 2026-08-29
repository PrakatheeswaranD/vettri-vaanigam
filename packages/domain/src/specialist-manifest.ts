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
  triggers: SPECIALIST_TRIGGERS,
  capabilities: SPECIALIST_CAPABILITIES,
  prohibited: SPECIALIST_PROHIBITED,
} as const;

export type SpecialistTrigger = (typeof SPECIALIST_TRIGGERS)[number];
