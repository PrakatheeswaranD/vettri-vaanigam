/**
 * PART 18 — the abandoned-checkout action, end to end through the real
 * route: proposal → policy → authorization → execution → verification →
 * ledger.
 *
 * Every refusal here is a way the feature could take money twice. The
 * happy path is one test; the rest are the guardrails, and they are the
 * reason this action exists separately from `recover_failed_payment`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { createInventoryTracker } from "./test-helpers/inventory-restore.js";
import { prisma } from "./db/client.js";
import { proposeGrowthAction } from "./modules/merchant-agent/service.js";
import { createFixtureProvider } from "./modules/agents/providers/fixture-provider.js";
import { CHECKOUT_REISSUE_STALE_AFTER_HOURS } from "@razorgrowth/domain";

let app: FastifyInstance;
let merchantId: string;

const inventory = createInventoryTracker();

beforeAll(async () => {
  app = await buildAuthedTestApp();
  merchantId = await getTestMerchantId(prisma);
  await inventory.capture(prisma);
});

afterAll(async () => {
  await inventory.restore(prisma);
  await app.close();
  await prisma.$disconnect();
});

async function productId(name: string): Promise<string> {
  return (await prisma.product.findFirstOrThrow({ where: { name } })).id;
}

async function cheapestActiveVariant(pid: string): Promise<string> {
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: pid, active: true, inventory: { availableQuantity: { gt: 0 } } },
    orderBy: { priceMinor: "asc" },
  });
  return variant.id;
}

/**
 * A real checkout, created through the real commerce path, then aged.
 *
 * Backdating `createdAt` rather than waiting is the only practical way to
 * test a 24-hour threshold, and it changes nothing the guards read except
 * the one thing under test.
 */
async function abandonedCheckout(ageHours = CHECKOUT_REISSUE_STALE_AFTER_HOURS + 6) {
  const pulseRunner = await productId("Meridian Pulse Runner");
  const provider = createFixtureProvider(
    {
      proposeGrowthAction: async ({ candidates }) => ({
        actionType: "CROSS_SELL",
        primaryProductId: pulseRunner,
        relatedProductIds: [candidates.find((c) => c.relationship === "COMPLEMENTARY" && c.readinessState !== "NOT_READY")!.productId],
        offer: null,
        reasonCodes: ["COMPLEMENTARY_PRODUCT"],
      }),
    },
    "LIVE_ANTHROPIC",
  );
  const proposal = await proposeGrowthAction(prisma, { merchantId, primaryProductId: pulseRunner }, provider);

  // Policy may legitimately require approval — the basket depends on which
  // complementary product currently has stock, and that drifts. Approve
  // when asked, exactly as the merchant would; these tests are about the
  // re-issue action, not about a catalogue price staying under a ceiling.
  const evalRes = await app.inject({ method: "POST", url: "/api/v1/policy/evaluate", payload: { proposalId: proposal.id } });
  let authorization = evalRes.json().authorization as { id: string } | null;
  if (!authorization) {
    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${proposal.id}/approve`,
      payload: { reason: "Approved by the re-issue fixture: the basket is above the auto-approval ceiling." },
    });
    expect(approve.statusCode, `approval failed: ${approve.body}`).toBe(200);
    authorization = approve.json().authorization as { id: string };
  }
  expect(authorization, `policy neither authorized nor approved: ${evalRes.body}`).toBeTruthy();

  const variantId = await cheapestActiveVariant(proposal.primaryProductId);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/commerce/checkout",
    payload: { authorizationId: authorization!.id, selection: { productId: proposal.primaryProductId, variantId, quantity: 1 }, idempotencyKey: randomUUID() },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();

  // Age BOTH. A genuinely abandoned checkout is one whose validity window
  // also lapsed — backdating only `createdAt` leaves a live window, which
  // the re-issue guard correctly refuses, and would have made this fixture
  // describe a state that does not occur.
  const createdAt = new Date(Date.now() - ageHours * 3_600_000);
  await prisma.checkoutSession.update({
    where: { id: body.checkoutId },
    data: { createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 60_000) },
  });
  return { checkoutId: body.checkoutId as string, orderId: body.orderId as string };
}

/** The subject is the ORDER, matching what the opportunity engine emits. */
function reissue(orderId: string) {
  return app.inject({ method: "POST", url: "/api/v1/merchant-agent/tools/reissue_abandoned_checkout", payload: { subjectId: orderId } });
}

describe("re-issuing an abandoned checkout", () => {
  it("hands the basket back, extends the window, and leaves a ledger trail", async () => {
    const { checkoutId, orderId } = await abandonedCheckout();
    const before = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutId } });

    const res = await reissue(orderId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome, body.detail).toBe("EXECUTED");
    expect(body.proposalId).toBeTruthy();
    expect(body.authorizationId).toBeTruthy();

    // The database, not the response, is the proof.
    const after = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutId } });
    expect(after.status).toBe("READY_FOR_PAYMENT");
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Same basket, same price. This action must never change the amount.
    expect(after.amountMinor).toBe(before.amountMinor);
    expect(after.orderId).toBe(before.orderId);

    // No new order and no new payment were invented for it.
    expect(await prisma.checkoutSession.count({ where: { orderId: before.orderId } })).toBe(1);
    expect(await prisma.payment.count({ where: { checkoutId } })).toBe(0);

    const events = await prisma.agentAction.findMany({
      where: { workflowId: after.workflowId },
      select: { actionType: true },
    });
    const types = events.map((event) => event.actionType);
    expect(types).toContain("CHECKOUT_REISSUE_PROPOSED");
    expect(types).toContain("CHECKOUT_REISSUE_AUTHORIZATION_CONSUMED");
    expect(types).toContain("CHECKOUT_REISSUED");

    // The governance record reached a verified terminal state.
    const proposal = await prisma.growthActionProposal.findUniqueOrThrow({ where: { id: body.proposalId } });
    expect(proposal.status).toBe("VERIFIED");
    expect(proposal.recoveryAction).toBe("REISSUE_CHECKOUT");
  });

  it("refuses a checkout that is not yet stale", async () => {
    const { checkoutId, orderId } = await abandonedCheckout(2);
    const res = await reissue(orderId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("REFUSED");
    expect(body.detail).toMatch(/abandoned only after/i);

    // A refusal is still recorded — an agent that only leaves a trail when
    // it acts is not auditable.
    const proposal = await prisma.growthActionProposal.findFirst({
      where: { merchantId, sourceCheckoutId: checkoutId },
      orderBy: { createdAt: "desc" },
    });
    expect(proposal?.status).toBe("REJECTED_VALIDATION");
    expect(proposal?.reasonCodes).toContain("CHECKOUT_NOT_STALE");
  });

  it("refuses once the order has been paid, whatever the session says", async () => {
    const { checkoutId, orderId } = await abandonedCheckout();
    await prisma.order.update({ where: { id: orderId }, data: { status: "PAID" } });

    const res = await reissue(orderId);
    const body = res.json();
    expect(body.outcome).toBe("REFUSED");
    expect(body.detail).toMatch(/already paid/i);

    // The session was already READY_FOR_PAYMENT, so its status proves
    // nothing here. The window is what a re-issue would have moved.
    const after = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutId } });
    expect(after.expiresAt.getTime(), "the window must not have been extended").toBeLessThan(Date.now());
  });

  it("refuses when a payment on the order was captured, even though the session looks abandoned", async () => {
    // The shape that matters most: the session never completed, so it
    // reads as abandoned, while money was actually taken.
    const { orderId } = await abandonedCheckout();
    await prisma.payment.create({
      data: {
        merchantId,
        orderId,
        state: "CAPTURED",
        amountMinor: 100,
        currency: "INR",
        provider: "MOCK",
      },
    });

    const res = await reissue(orderId);
    const body = res.json();
    expect(body.outcome).toBe("REFUSED");
    expect(body.detail).toMatch(/money has moved|CAPTURED/i);
  });

  it("demands reconciliation rather than guessing when a payment state is UNKNOWN", async () => {
    const { orderId } = await abandonedCheckout();
    await prisma.payment.create({
      data: {
        merchantId,
        orderId,
        state: "UNKNOWN",
        amountMinor: 100,
        currency: "INR",
        provider: "MOCK",
      },
    });

    const res = await reissue(orderId);
    const body = res.json();
    expect(body.outcome).toBe("REFUSED");
    expect(body.detail).toMatch(/unverified is not unpaid/i);
  });

  it("is idempotent: one authorization re-opens one checkout", async () => {
    const { orderId } = await abandonedCheckout();
    const first = (await reissue(orderId)).json();
    expect(first.outcome).toBe("EXECUTED");

    // A second invocation builds a NEW proposal, and that proposal must be
    // refused — the checkout is no longer stale, because it was just
    // re-issued. The guardrail that stops a loop is the same one that
    // stops interference.
    // The second attempt must refuse: the checkout now has a live window.
    // Extending `expiresAt` does not make `createdAt` younger, so without
    // the window guard this would succeed on every cycle for ever.
    const second = (await reissue(orderId)).json();
    expect(second.outcome, second.detail).toBe("REFUSED");
    expect(second.detail).toMatch(/already open/i);
  });
});
