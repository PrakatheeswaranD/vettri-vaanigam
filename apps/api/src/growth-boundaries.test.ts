/**
 * The two halves of Part 5 that a merchant actually touches: the
 * boundaries they set, and the lift a real holdout measures.
 *
 * WHY THESE ARE WORTH PINNING
 *
 * The boundaries were read-only. Under a product whose premise is "the
 * merchant sets the limits and the agent works inside them", an immutable
 * envelope is the more serious half of that sentence missing — and the
 * failure is silent, because a read-only config still renders perfectly.
 *
 * The lift was computed by nothing. Campaigns hash-bucketed every subject
 * into CONTROL or TREATMENT before any offer was made — a genuine holdout,
 * the only basis in this product for a causal claim — and no code path ever
 * compared the two cohorts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import type { MerchantGrowthConfigDTO } from "@razorgrowth/contracts";
import type { CampaignLift } from "@razorgrowth/domain";
import { getRevenueOpportunityReport } from "./modules/growth/revenue-evidence-service.js";

let app: FastifyInstance;
let merchantId: string;

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function config(): Promise<MerchantGrowthConfigDTO> {
  const res = await app.inject({ method: "GET", url: "/api/v1/merchant-agent/growth/config" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as MerchantGrowthConfigDTO;
}

describe("growth boundaries — the merchant's own job", () => {
  it("accepts a partial change without clobbering the rest of the envelope", async () => {
    const before = await config();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/merchant-agent/growth/config",
        payload: { maxProposedDiscountBps: 750 },
      });
      expect(res.statusCode, res.body).toBe(200);

      const after = res.json() as MerchantGrowthConfigDTO;
      expect(after.maxProposedDiscountBps).toBe(750);
      // Everything the merchant did not mention is untouched. A form that
      // silently resets a ceiling nobody opened it to change is worse than
      // one that refuses partial edits.
      expect(after.maxUpsellIncreaseBps).toBe(before.maxUpsellIncreaseBps);
      expect(after.crossSellEnabled).toBe(before.crossSellEnabled);
      expect(after.maxBundleItems).toBe(before.maxBundleItems);
    } finally {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/merchant-agent/growth/config",
        payload: { maxProposedDiscountBps: before.maxProposedDiscountBps },
      });
    }
  });

  it("refuses a ceiling outside the schema's bounds", async () => {
    // A typo that adds a zero would otherwise authorise every future offer
    // beneath it.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant-agent/growth/config",
      payload: { maxProposedDiscountBps: 90_000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an empty change rather than writing nothing and reporting success", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/merchant-agent/growth/config", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("writes every change to the audit ledger", async () => {
    const before = await config();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/merchant-agent/growth/config",
      payload: { bundleEnabled: !before.bundleEnabled },
    });
    try {
      const event = await prisma.agentAction.findFirst({
        where: { merchantId, actionType: "GROWTH_BOUNDARIES_UPDATED" },
        orderBy: { createdAt: "desc" },
      });
      expect(event).not.toBeNull();
      // Raising a ceiling authorises every action beneath it, so what it
      // was and what it became has to be recoverable.
      expect(JSON.stringify(event!.metadata)).toContain("bundleEnabled");
    } finally {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/merchant-agent/growth/config",
        payload: { bundleEnabled: before.bundleEnabled },
      });
    }
  });

  it("changes what the engine may even detect", async () => {
    const before = await config();
    try {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/merchant-agent/growth/config",
        payload: { boundedOffersEnabled: false, upsellEnabled: false },
      });
      const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);

      // The boundary is not decoration: switching offers off must remove
      // the offer opportunity from detection entirely, not merely block it
      // later in the pipeline.
      expect(opportunities.find((o) => o.type === "ELIGIBLE_OFFER")).toBeUndefined();
      expect(opportunities.find((o) => o.type === "UPSELL")).toBeUndefined();
    } finally {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/merchant-agent/growth/config",
        payload: { boundedOffersEnabled: before.boundedOffersEnabled, upsellEnabled: before.upsellEnabled },
      });
    }
  });
});

describe("campaign lift — the one causal claim, now computed", () => {
  it("returns a lift alongside both cohorts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/campaigns",
      payload: {
        name: "Part 5 lift check",
        actionType: "UPSELL",
        budgetMinor: 500_000,
        incentiveMinorPerConversion: 10_000,
        controlPercentBps: 2_000,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    // 201: the campaign is created, not merely accepted.
    expect(created.statusCode, created.body).toBe(201);
    const campaignId = (created.json() as { id: string }).id;

    const metrics = await app.inject({ method: "GET", url: `/api/v1/campaigns/${campaignId}/metrics` });
    expect(metrics.statusCode).toBe(200);

    const body = metrics.json() as { treatment: unknown; control: unknown; lift: CampaignLift };
    expect(body.treatment).toBeDefined();
    expect(body.control).toBeDefined();
    expect(body.lift).toBeDefined();

    // A campaign nobody has been assigned to yet must not report a lift.
    expect(body.lift.liftBps).toBeNull();
    expect(body.lift.attributableRevenueMinor).toBeNull();
    // ...and must say why, rather than showing a blank.
    expect(body.lift.explanation.length).toBeGreaterThan(0);
    expect(["NO_HOLDOUT", "INSUFFICIENT_SAMPLE"]).toContain(body.lift.basis);
  });
});

describe("learning — the engine only estimates what a holdout measured", () => {
  it("withholds the offer estimate while no campaign has produced a lift", async () => {
    const { opportunities } = await getRevenueOpportunityReport(prisma, merchantId);
    const offer = opportunities.find((o) => o.type === "ELIGIBLE_OFFER");
    if (!offer) return;

    // This merchant's campaigns have no measured lift yet, so the estimate
    // must stay withheld — the whole point of the LEARN step is that it
    // does not start guessing before it has evidence.
    expect(offer.expectedEffect.expectedIncrementalValue).toBeNull();
    expect(offer.expectedEffect.basis).toBe("INSUFFICIENT_EVIDENCE");
    expect(offer.expectedEffect.method).toContain("control group");
  });
});
