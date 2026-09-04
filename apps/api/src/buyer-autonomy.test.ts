/**
 * Buyer-controlled boundaries, and an activity feed that cannot lie.
 *
 * TWO CLAIMS UNDER TEST
 *
 * 1. **Every boundary is enforced in backend code before a purchase is
 *    priced.** Not in the console, not by hiding a button. Each test sets
 *    a boundary, drives a real purchase through the same service both the
 *    HTTP route and the conversation use, and asserts the specific refusal
 *    — never merely "it didn't succeed", which a 404 would also satisfy.
 *
 * 2. **Every activity event corresponds to a real backend action.** The
 *    feed reads the hash-chained `AgentAction` ledger, so the test asserts
 *    each returned event exists as a ledger row with the same id, actor
 *    and timestamp. An event the ledger does not contain is a fabricated
 *    one, and this is the assertion that makes that impossible.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BuyerActivityResponseDTO, BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { buildCustomerTestApp, getTestBuyerContextId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

let app: FastifyInstance;
let buyerContextId: string;
const createdProposalIds: string[] = [];

/** Restores the buyer's real policy however an assertion goes. */
async function withPolicy<T>(data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const before = await prisma.buyerSpendingPolicy.findUniqueOrThrow({ where: { customerAccountId: buyerContextId } });
  await prisma.buyerSpendingPolicy.update({ where: { customerAccountId: buyerContextId }, data });
  try {
    return await fn();
  } finally {
    await prisma.buyerSpendingPolicy.update({
      where: { customerAccountId: buyerContextId },
      data: {
        maxPurchaseAmountMinor: before.maxPurchaseAmountMinor,
        restrictedCategories: before.restrictedCategories as never,
        preferredCategories: before.preferredCategories as never,
        autoPurchaseEnabled: before.autoPurchaseEnabled,
        restrictedMerchantIds: before.restrictedMerchantIds as never,
        autonomousPurchaseLimitMinor: before.autonomousPurchaseLimitMinor,
        dailyLimitMinor: before.dailyLimitMinor,
      },
    });
  }
}

/** A variant this buyer could genuinely buy, so a refusal is attributable
 * to the boundary under test and not to the fixture. */
async function purchasableVariant() {
  const policy = await prisma.buyerSpendingPolicy.findUniqueOrThrow({ where: { customerAccountId: buyerContextId } });
  const allowed = Array.isArray(policy.allowedCategories)
    ? policy.allowedCategories.filter((c): c is string => typeof c === "string")
    : [];

  return prisma.productVariant.findFirstOrThrow({
    where: {
      active: true,
      product: {
        status: "ACTIVE",
        merchant: { status: "ACTIVE" },
        ...(policy.allowAllCategories || allowed.length === 0 ? {} : { category: { in: allowed } }),
      },
      inventory: { availableQuantity: { gte: 2 } },
    },
    orderBy: { priceMinor: "asc" },
    include: { product: true },
  });
}

async function propose(variantId: string, quantity = 1) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/buyer/purchase-proposals",
    payload: { variantId, quantity },
  });
  if (res.statusCode === 200) createdProposalIds.push((res.json() as { id: string }).id);
  return res;
}

beforeAll(async () => {
  app = await buildCustomerTestApp();
  buyerContextId = await getTestBuyerContextId(prisma);
});

afterAll(async () => {
  if (createdProposalIds.length > 0) {
    await prisma.decisionRecord.deleteMany({ where: { id: { in: createdProposalIds }, settlementStatus: "PROPOSED" } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("boundaries are enforced in the backend, before a purchase is priced", () => {
  it("declines above the hard maximum, and does NOT offer it for approval", async () => {
    const variant = await purchasableVariant();

    // A maximum below the price. The distinction under test: this is a
    // refusal, not a step-up. Approving it was never on the table.
    await withPolicy({ maxPurchaseAmountMinor: Math.max(0, variant.priceMinor - 1) }, async () => {
      const res = await propose(variant.id);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { outcome: string; explanation: string };

      expect(body.outcome).toBe("DECLINE");
      expect(body.explanation).toContain("MAX_PURCHASE_AMOUNT_EXCEEDED");
    });
  });

  it("declines a restricted category even when it is also on the allow list", async () => {
    const variant = await purchasableVariant();

    // The category is allowed (the fixture guarantees it) AND restricted.
    // A prohibition that a wider allow list could undo was never a
    // prohibition, so restricted has to win.
    await withPolicy({ restrictedCategories: [variant.product.category] }, async () => {
      const res = await propose(variant.id);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { outcome: string; explanation: string };

      expect(body.outcome).toBe("DECLINE");
      expect(body.explanation).toContain("CATEGORY_RESTRICTED");
    });
  });

  it("declines a restricted merchant", async () => {
    const variant = await purchasableVariant();

    await withPolicy({ restrictedMerchantIds: [variant.product.merchantId] }, async () => {
      const res = await propose(variant.id);
      const body = res.json() as { outcome: string; explanation: string };
      expect(body.outcome).toBe("DECLINE");
      expect(body.explanation).toContain("MERCHANT_RESTRICTED");
    });
  });

  it("turns every purchase into a step-up when automatic purchasing is off", async () => {
    const variant = await purchasableVariant();

    // Well under the autonomous limit — it would auto-approve normally.
    await withPolicy(
      { autoPurchaseEnabled: false, autonomousPurchaseLimitMinor: 100_000_000, maxPurchaseAmountMinor: 100_000_000 },
      async () => {
        const res = await propose(variant.id);
        const body = res.json() as { outcome: string; requiresApproval: boolean; explanation: string };

        // A step-up, NOT a decline. Wanting to approve each purchase is
        // not the same as refusing to make them.
        expect(body.outcome).toBe("STEP_UP");
        expect(body.requiresApproval).toBe(true);
        expect(body.explanation).toMatch(/approve every purchase/i);
      },
    );
  });

  it("auto-approves under the limit when automatic purchasing is on", async () => {
    const variant = await purchasableVariant();

    // The control for the test above: same purchase, switch on.
    await withPolicy(
      { autoPurchaseEnabled: true, autonomousPurchaseLimitMinor: 100_000_000, maxPurchaseAmountMinor: 100_000_000, dailyLimitMinor: 100_000_000 },
      async () => {
        const res = await propose(variant.id);
        const body = res.json() as { outcome: string };
        expect(body.outcome).toBe("AUTO_APPROVE");
      },
    );
  });

  it("never blocks on a preferred category — it is a signal, not a gate", async () => {
    const variant = await purchasableVariant();

    // A preference for something else entirely must not refuse this
    // purchase. "I prefer running shoes" is not "refuse everything else".
    await withPolicy(
      { preferredCategories: ["Something The Buyer Never Buys"], maxPurchaseAmountMinor: 100_000_000, dailyLimitMinor: 100_000_000 },
      async () => {
        const res = await propose(variant.id);
        const body = res.json() as { outcome: string; explanation: string };
        expect(body.outcome).not.toBe("DECLINE");
        expect(body.explanation).not.toContain("PREFERRED");
      },
    );
  });

  it("cannot be bypassed by naming a boundary in the request body", async () => {
    const variant = await purchasableVariant();

    await withPolicy({ maxPurchaseAmountMinor: Math.max(0, variant.priceMinor - 1) }, async () => {
      // The attack: send your own ceiling and hope the server trusts it.
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/buyer/purchase-proposals",
        payload: {
          variantId: variant.id,
          quantity: 1,
          maxPurchaseAmountMinor: 100_000_000,
          autoPurchaseEnabled: true,
          restrictedCategories: [],
        },
      });
      if (res.statusCode === 200) {
        createdProposalIds.push((res.json() as { id: string }).id);
        // The saved policy decides, never the request.
        expect((res.json() as { outcome: string }).outcome).toBe("DECLINE");
      } else {
        expect([400, 422]).toContain(res.statusCode);
      }
    });
  });

  it("re-checks the boundary at authorization, not only at pricing", async () => {
    const variant = await purchasableVariant();

    // Price it while permitted...
    const created = await withPolicy(
      { maxPurchaseAmountMinor: 100_000_000, dailyLimitMinor: 100_000_000, autonomousPurchaseLimitMinor: 100_000_000 },
      async () => {
        const res = await propose(variant.id);
        return res.statusCode === 200 ? (res.json() as { id: string; outcome: string }) : null;
      },
    );
    if (!created || created.outcome === "DECLINE") return;

    // ...then restrict the category and try to authorize the proposal
    // that is already in flight. The window between pricing and
    // authorizing is exactly when someone changes their mind.
    await withPolicy({ restrictedCategories: [variant.product.category] }, async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/buyer/purchase-proposals/${created.id}/authorize`,
      });
      expect(res.statusCode, res.body).not.toBe(200);
      expect(res.body).toMatch(/no longer permits/i);
    });
  });
});

describe("agent activity is read from the ledger, never generated", () => {
  it("returns only events that exist as real ledger rows", async () => {
    // Drive a real conversation so there is genuine activity to read.
    const search = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Show running shoes." },
    });
    expect(search.statusCode).toBe(200);
    const conversation = (search.json() as BuyerAgentResponseDTO).conversationId;
    await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { conversationId: conversation, message: "Compare 1 and 2." },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    expect(res.statusCode, res.body).toBe(200);
    const activity = res.json() as BuyerActivityResponseDTO;

    expect(activity.workflows.length, "no activity to verify — this test would prove nothing").toBeGreaterThan(0);

    // THE ASSERTION THAT MAKES FABRICATION IMPOSSIBLE. Every event must
    // be a ledger row with the same id, actor and timestamp.
    for (const workflow of activity.workflows) {
      expect(workflow.events.length).toBeGreaterThan(0);
      for (const event of workflow.events) {
        const row = await prisma.agentAction.findUnique({ where: { id: event.id } });
        expect(row, `event ${event.id} (${event.actionType}) is not in the ledger`).not.toBeNull();
        expect(row!.workflowId).toBe(workflow.workflowId);
        expect(row!.actionType).toBe(event.actionType);
        expect(row!.actorType).toBe(event.actor);
        expect(row!.conciseReason).toBe(event.detail);
        expect(row!.createdAt.toISOString()).toBe(event.at);
      }
    }
  });

  it("reports only the stages a workflow actually reached", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const activity = res.json() as BuyerActivityResponseDTO;

    for (const workflow of activity.workflows) {
      const stagesInEvents = new Set(workflow.events.map((e) => e.stage));

      // A stage is listed only if an event produced it. A ten-step
      // timeline with seven steps greyed out and invented is a lie with a
      // nice animation.
      expect(new Set(workflow.reachedStages)).toEqual(stagesInEvents);

      // And they are ordered as the pipeline runs, not by insert order.
      const positions = workflow.reachedStages.map((s) => activity.stageOrder.indexOf(s));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("records a comparison and an offer check, which used to leave no trace", async () => {
    const search = await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { message: "Show running shoes." },
    });
    const conversation = (search.json() as BuyerAgentResponseDTO).conversationId;
    await app.inject({
      method: "POST",
      url: "/api/v1/buyer/messages",
      payload: { conversationId: conversation, message: "Compare 1 and 2." },
    });

    // Both were trace-only before Part 12 — real actions the buyer could
    // never see afterwards, because the activity feed reads the ledger.
    expect(await prisma.agentAction.count({ where: { actionType: "COMPARISON_BUILT" } })).toBeGreaterThan(0);
    expect(await prisma.agentAction.count({ where: { actionType: "OFFERS_EVALUATED" } })).toBeGreaterThan(0);
  });

  it("never exposes chain-of-thought", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const activity = res.json() as BuyerActivityResponseDTO;

    for (const workflow of activity.workflows) {
      for (const event of workflow.events) {
        // Details are structured facts written at the time of the action.
        expect(event.detail.toLowerCase()).not.toMatch(/\bi think\b|\blet me\b|\bstep \d|reasoning:|thought:/);
      }
    }
  });

  it("shows one buyer only their own workflows", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/buyer/activity" });
    const activity = res.json() as BuyerActivityResponseDTO;

    // The ledger is merchant-scoped and shared with every merchant-side
    // event. A shopper has no business reading a seller's growth
    // proposals, so every workflow returned must trace back to this
    // buyer's own decisions or conversations.
    const ownDecisionWorkflows = new Set(
      (
        await prisma.decisionRecord.findMany({
          where: { protocolActorRef: buyerContextId, workflowId: { not: null } },
          select: { workflowId: true },
        })
      ).map((d) => d.workflowId!),
    );
    const ownConversationIds = new Set(
      (await prisma.buyerConversation.findMany({ where: { customerAccountId: buyerContextId }, select: { id: true } })).map(
        (c) => c.id,
      ),
    );

    for (const workflow of activity.workflows) {
      const fromOwnDecision = ownDecisionWorkflows.has(workflow.workflowId);
      const fromOwnConversation = await prisma.agentAction.count({
        where: {
          workflowId: workflow.workflowId,
          relatedEntityType: "BuyerConversation",
          relatedEntityId: { in: [...ownConversationIds] },
        },
      });
      expect(fromOwnDecision || fromOwnConversation > 0, `workflow ${workflow.workflowId} is not this buyer's`).toBe(true);
    }
  });
});
