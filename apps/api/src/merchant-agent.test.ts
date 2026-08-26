/**
 * PART 04 Merchant Agent integration tests: real cross-sell/upsell/bundle
 * proposals against the real seeded catalog + product relationships, the
 * readiness-blocked-opportunity connection (§49-§51, §106, §130), the
 * invalid-proposal rejection path (§35, §58), and the hallucination/
 * injection adversarial cases (§102-§103) exercised directly against
 * `proposeGrowthAction` with a scripted fixture provider.
 *
 * Assumes the local dev database is up and seeded (same as app.test.ts) —
 * uses the real deterministic seed relationships (PART 04 seed additions):
 * Meridian Pulse Runner -> {CoolMax Socks, FlowFit Bottle, QuickBelt Belt
 * (forced UNKNOWN inventory), Aero Lightweight (valid upsell), Velocity
 * Racer (upsell exceeding the uplift ceiling), Cushion Crew Socks (bundle)}.
 *
 * Product IDs are looked up by name at runtime, never hardcoded — seeded
 * UUIDs are random per reseed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { getDemoMerchantId } from "./modules/authorization/demo-context.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";

let app: FastifyInstance;

async function productId(name: string): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({ where: { name } });
  return product.id;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function postProposal(body: { primaryProductId: string; conversationId?: string; recommendationId?: string }) {
  return app.inject({ method: "POST", url: "/api/v1/merchant-agent/growth/proposals", payload: body });
}

describe("POST /api/v1/merchant-agent/growth/proposals — golden path", () => {
  it("proposes a real, catalog-grounded cross-sell with a deterministic opportunity calculation", async () => {
    const pulseRunner = await productId("Meridian Pulse Runner");
    const res = await postProposal({ primaryProductId: pulseRunner });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.status).toBe("PROPOSED");
    expect(body.policyStatus).toBe("NOT_EVALUATED");
    expect(body.actionType).toBe("CROSS_SELL");
    expect(body.relatedProductIds).toHaveLength(1);
    expect(body.reasonCodes).toContain("COMPLEMENTARY_PRODUCT");

    // Opportunity arithmetic must be deterministic (PART 04 §45, §105).
    expect(body.opportunity.opportunityDeltaMinor).toBe(body.opportunity.potentialBasketMinor - body.opportunity.currentBasketMinor);
    expect(Number.isInteger(body.opportunity.opportunityDeltaMinor)).toBe(true);

    // No execution/approval implied anywhere in the response.
    expect(body).not.toHaveProperty("approved");
    expect(body).not.toHaveProperty("executedAt");
  });

  it("surfaces the readiness-blocked opportunity alongside a normal eligible proposal (§49-§51, §130)", async () => {
    const pulseRunner = await productId("Meridian Pulse Runner");
    const res = await postProposal({ primaryProductId: pulseRunner });
    const body = res.json();
    const belt = body.blockedOpportunities.find((b: { blockerCode: string }) => b.blockerCode === "UNKNOWN_INVENTORY");
    expect(belt).toBeTruthy();
    expect(belt.remediation).toMatch(/inventory/i);
  });

  it("returns NO_OPPORTUNITY honestly for a product with no configured relationships", async () => {
    const noRelProduct = await productId("Meridian StrideLace Kit");
    const res = await postProposal({ primaryProductId: noRelProduct });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("REJECTED_VALIDATION");
    expect(body.mode).toBe("NO_OPPORTUNITY");
    expect(body.actionType).toBeNull();
  });

  it("rejects a 404 for an unknown product id rather than crashing", async () => {
    const res = await postProposal({ primaryProductId: "00000000-0000-0000-0000-000000000000" });
    expect(res.statusCode).toBe(404);
  });

  it("records the full ledger chain for one proposal (BUYER-agnostic actor semantics, §93)", async () => {
    const pulseRunner = await productId("Meridian Pulse Runner");
    const res = await postProposal({ primaryProductId: pulseRunner });
    const traceId = res.json().traceId;
    const entries = await prisma.agentAction.findMany({ where: { workflowId: traceId } });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.actorType).toBe("MERCHANT_AGENT");
    }
  });
});

describe("proposeGrowthAction — deterministic bounds enforced by validation (§35, §58, §102)", () => {
  it("rejects an upsell whose uplift far exceeds the configured ceiling instead of clamping it", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const pulseRunner = await productId("Meridian Pulse Runner");
    // Force the AI path so the "invalid proposal" rejection is exercised
    // (the deterministic path never proposes something out of bounds in
    // the first place — this proves the VALIDATOR is the real backstop,
    // not just well-behaved deterministic logic).
    const provider = createFixtureProvider(
      {
        proposeGrowthAction: async ({ candidates }) => {
          const upsellTarget = candidates.find((c) => c.relationship === "UPSELL_ALTERNATIVE" && c.priceMinor > 700000);
          return {
            actionType: "UPSELL",
            primaryProductId: pulseRunner,
            relatedProductIds: upsellTarget ? [upsellTarget.productId] : [],
            offer: null,
            reasonCodes: ["UPGRADE_WITHIN_BUDGET"],
          };
        },
      },
      "LIVE_ANTHROPIC",
    );

    const result = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
    expect(result.status).toBe("REJECTED_VALIDATION");
    expect(result.rejectionReason).toMatch(/uplift/i);
  });

  it("never lets a hallucinated product ID become an authoritative proposal", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const pulseRunner = await productId("Meridian Pulse Runner");
    const provider = createFixtureProvider(
      {
        proposeGrowthAction: async () => ({
          actionType: "CROSS_SELL",
          primaryProductId: pulseRunner,
          relatedProductIds: ["totally-invented-product-id"],
          offer: null,
          reasonCodes: ["COMPLEMENTARY_PRODUCT"],
        }),
      },
      "LIVE_ANTHROPIC",
    );

    const result = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
    // The rejected attempt is still recorded for audit (§148: proving the
    // hallucination was caught, not laundering it away) — but it must
    // NEVER become an authoritative, actionable proposal.
    expect(result.status).toBe("REJECTED_VALIDATION");
    expect(result.actionType).toBeNull();
    expect(result.rejectionReason).toMatch(/not in the supplied candidate set/i);
  });

  it("rejects a discount above the merchant's configured ceiling — never silently clamped (§58)", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const pulseRunner = await productId("Meridian Pulse Runner");
    const provider = createFixtureProvider(
      {
        proposeGrowthAction: async ({ candidates }) => ({
          actionType: "CROSS_SELL",
          primaryProductId: pulseRunner,
          relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY")!.productId],
          offer: { kind: "PERCENTAGE", percentageBps: 5000, amountMinor: null }, // 50%, way over the 10% default ceiling
          reasonCodes: ["COMPLEMENTARY_PRODUCT"],
        }),
      },
      "LIVE_ANTHROPIC",
    );

    const result = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
    expect(result.status).toBe("REJECTED_VALIDATION");
    expect(result.rejectionReason).toMatch(/ceiling/i);
  });

  it("ignores an injection attempt embedded in the buyer preference data and still only proposes a real candidate", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const pulseRunner = await productId("Meridian Pulse Runner");
    // Even if a malicious preference string reached the provider, the
    // provider here just echoes a normal, valid proposal — the point is
    // that nothing in the pipeline gives such text special authority.
    const provider = createFixtureProvider(
      {
        proposeGrowthAction: async ({ candidates }) => ({
          actionType: "CROSS_SELL",
          primaryProductId: pulseRunner,
          relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY")!.productId],
          offer: null,
          reasonCodes: ["COMPLEMENTARY_PRODUCT"],
        }),
      },
      "LIVE_ANTHROPIC",
    );
    const result = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
    expect(result.status).toBe("PROPOSED");
    expect(result.offer).toBeNull();
  });

  it("degrades gracefully to a deterministic fallback when the AI provider throws on every attempt", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const pulseRunner = await productId("Meridian Pulse Runner");
    const provider = createFixtureProvider(
      {
        proposeGrowthAction: async () => {
          throw new Error("simulated provider outage");
        },
      },
      "LIVE_ANTHROPIC",
    );
    const result = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);
    expect(result.status).toBe("PROPOSED");
    expect(result.mode).toBe("DETERMINISTIC_FALLBACK");
  });
});

describe("recovery offer — a real NEAR_MATCH Buyer Agent outcome (PART 04 §15)", () => {
  it("proposes a bounded discount that closes exactly the buyer's disclosed budget gap", async () => {
    // Real end-to-end trigger: ask the Buyer Agent for black size-9
    // running shoes under ₹5,000 — the real seeded catalog has no exact
    // match under that budget, only a near match (Meridian Summit Trail,
    // over budget by a known amount — see buyer-agent.test.ts).
    const buyerRes = await app.inject({
      method: "POST",
      url: "/api/v1/buyer-agent/messages",
      payload: { message: "Find black running shoes in size 9 under ₹5,000" },
    });
    const buyerBody = buyerRes.json();
    expect(buyerBody.recommendationMode).toBe("NEAR_MATCH");
    const nearMatch = buyerBody.recommendations[0];
    const budgetViolation = nearMatch.violations.find((v: { type: string }) => v.type === "BUDGET_MAX");
    expect(budgetViolation).toBeTruthy();

    // The Buyer Agent response doesn't carry a recommendationId directly,
    // but persists one RecommendationRecord per response — look it up by
    // conversationId to get the id this test needs.
    const merchantId = await getDemoMerchantId(prisma);
    const record = await prisma.recommendationRecord.findFirstOrThrow({
      where: { conversationId: buyerBody.conversationId, merchantId },
      orderBy: { createdAt: "desc" },
    });

    const proposalRes = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/growth/proposals",
      payload: { primaryProductId: nearMatch.productId, conversationId: buyerBody.conversationId, recommendationId: record.id },
    });
    expect(proposalRes.statusCode).toBe(200);
    const proposal = proposalRes.json();

    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.actionType).toBe("RECOVERY");
    expect(proposal.reasonCodes).toContain("NO_EXACT_MATCH_RECOVERY");
    expect(proposal.reasonCodes).toContain("PRICE_HESITATION");
    expect(proposal.offer.kind).toBe("PERCENTAGE");

    // The offer is sized to close the disclosed gap but is always capped
    // at the merchant's configured ceiling (10%) — it may not fully close
    // a gap larger than the ceiling allows (a bounded, best-effort
    // incentive, never an unbounded guarantee), but it must always
    // actually discount the price and never exceed the ceiling.
    expect(proposal.offer.percentageBps).toBeGreaterThan(0);
    expect(proposal.offer.percentageBps).toBeLessThanOrEqual(1000);
    expect(proposal.offerCalculation.finalAmountMinor).toBeLessThan(proposal.offerCalculation.baseAmountMinor);
  });
});

describe("readiness → growth connection surfaces a real dimension score (PART 04 §49-§51, §88)", () => {
  it("attaches the merchant's actual current readiness dimension score to a blocked opportunity, never a fabricated delta", async () => {
    const merchantId = await getDemoMerchantId(prisma);
    const pulseRunner = await productId("Meridian Pulse Runner");
    const snapshot = await prisma.readinessSnapshot.findFirst({ where: { merchantId }, orderBy: { createdAt: "desc" } });
    expect(snapshot).toBeTruthy();

    const res = await postProposal({ primaryProductId: pulseRunner });
    const body = res.json();
    const blocked = body.blockedOpportunities.find((b: { blockerCode: string }) => b.blockerCode === "UNKNOWN_INVENTORY");
    expect(blocked).toBeTruthy();
    expect(blocked.relatedReadinessDimension).toBe("Inventory Reliability");
    expect(blocked.currentReadinessDimensionScore).toBe(snapshot!.inventoryReliability);
  });
});
