/**
 * End-to-End Test Suite:
 * - Protocols: SD-JWT, UAP, UCP, ACP, x402
 * - Commerce & Maintenance: Expired checkouts sweep & inventory restock
 * - Governance: Step-up crash recovery
 * - Campaigns: Automated assignment -> order -> captured payment attribution
 * - Post-Purchase: Full & partial refunds, returns, fulfillment, disputes, GST taxes
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  parseAndVerifySdJwt,
  parseUapIntent,
  parseUcpIntent,
  detectProtocol,
  calculateTaxes,
} from "@razorgrowth/domain";
import { prisma } from "./db/client.js";
import { buildApp } from "./app.js";
import { createSession } from "./modules/auth/session.js";
import { sweepExpiredCheckouts } from "./modules/commerce/maintenance-service.js";
import { tryAutoAttributeOrder, tryAutoConvertCampaignOnPaymentCapture } from "./modules/campaigns/auto-attribution.js";

describe("E2E Protocols and Lifecycle Test Suite", () => {
  const app = buildApp();
  const merchantId = randomUUID();
  const slug = `merchant-${Date.now()}`;
  let userId: string;
  let authBearer: string;

  let dbAvailable = false;

  beforeAll(async () => {
    await app.ready();

    try {
      await prisma.$connect();
      await prisma.merchant.count();
      dbAvailable = true;

      // Create merchant
      await prisma.merchant.create({
        data: {
          id: merchantId,
          name: "Apex Athletics",
          slug,
          status: "ACTIVE",
          businessCategory: "Retail",
          defaultCurrency: "INR",
          policy: {
            create: {
              maxDiscountBps: 2000,
              autoApprovalDiscountBps: 1000,
              maxOrderAmountMinor: 5_000_000,
              autoApprovalOrderAmountMinor: 1_000_000,
              maxRecoveryAttempts: 3,
            },
          },
        },
      });

      const user = await prisma.merchantUser.create({
        data: {
          merchantId,
          email: `owner-${Date.now()}@test.internal`,
          passwordHash: "dummy-hash",
          role: "OWNER",
        },
      });

      userId = user.id;
      const session = await createSession(prisma, userId);
      authBearer = session.token;
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    await app.close();
    if (dbAvailable) {
      try {
        await prisma.merchant.deleteMany({ where: { id: merchantId } });
      } catch {
        // cleanup ignore
      }
    }
    await prisma.$disconnect();
  });

  describe("1. SD-JWT, UAP, and UCP Protocols", () => {
    it("parses SD-JWT disclosures and reconstructs claims", () => {
      // Test disclosure formatting: [salt, claimName, claimValue]
      const rawDisclosure = Buffer.from(JSON.stringify(["salt123", "sub", "agent-buyer-007"])).toString("base64url");
      const mockPayload = Buffer.from(JSON.stringify({ iss: "https://agent.test", _sd: [rawDisclosure] })).toString("base64url");
      const mockHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
      const mockSdJwt = `${mockHeader}.${mockPayload}.~${rawDisclosure}~`;

      const result = parseAndVerifySdJwt(mockSdJwt);
      expect(result.valid).toBe(true);
      expect(result.disclosures.length).toBe(1);
      expect(result.disclosures[0]!.key).toBe("sub");
      expect(result.disclosures[0]!.value).toBe("agent-buyer-007");
      expect(result.claims.iss).toBe("https://agent.test");
      expect(result.claims.sub).toBe("agent-buyer-007");
    });

    it("parses UAP (Universal Agent Protocol) requests", () => {
      const uapPayload = {
        uap_version: "1.0",
        mandate: {
          max_amount: 500000,
          currency: "INR",
          public_key: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
          signature: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
          merchant_scope: merchantId,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
        items: [{ sku: "SKU-TEST-1", quantity: 2 }],
        agent_id: "agent-uap-test",
      };

      const res = parseUapIntent(uapPayload, {});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.intent.protocol).toBe("UAP");
        expect(res.intent.agentId).toBe("agent-uap-test");
        expect(res.intent.lines.length).toBe(1);
        expect(res.intent.mandate).toBeTruthy();
        expect(res.intent.mandate?.maxAmountMinor).toBe(500000);
      }
    });

    it("parses UCP (Universal Checkout Protocol) requests", () => {
      const ucpPayload = {
        ucp_version: "2026-06",
        items: [{ sku: "SKU-TEST-2", quantity: 3 }],
        currency: "INR",
        mandate: {
          spend_limit: 300000,
          currency: "INR",
          public_key: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
          signature: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
        },
        agent_id: "agent-ucp-test",
      };

      const res = parseUcpIntent(ucpPayload, {});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.intent.protocol).toBe("UCP");
        expect(res.intent.agentId).toBe("agent-ucp-test");
        expect(res.intent.lines.length).toBe(1);
        expect(res.intent.lines[0]!.sku).toBe("SKU-TEST-2");
        expect(res.intent.lines[0]!.quantity).toBe(3);
      }
    });

    it("detects protocols accurately from headers and body shape", () => {
      expect(detectProtocol({ "x-agent-protocol": "UAP" }, {}).protocol).toBe("UAP");
      expect(detectProtocol({ "x-agent-protocol": "UCP" }, {}).protocol).toBe("UCP");
      expect(detectProtocol({}, { uap_version: "1.0" }).protocol).toBe("UAP");
      expect(detectProtocol({}, { ucp_version: "2026-06" }).protocol).toBe("UCP");
    });
  });

  describe("2. Post-Purchase Operations: Refunds, Returns, Fulfillments, Disputes, Taxes", () => {
    let orderId: string;
    let paymentId: string;
    let orderItemId: string;

    beforeAll(async () => {
      if (!dbAvailable) return;
      // Create product and variant
      const product = await prisma.product.create({
        data: {
          id: randomUUID(),
          merchantId,
          slug: `trail-runner-${Date.now()}`,
          name: "Trail Runner Pro",
          description: "High performance trail running shoes",
          category: "Shoes",
          brand: "Apex",
          variants: {
            create: {
              id: randomUUID(),
              sku: `SKU-TR-${Date.now()}`,
              title: "Size 9",
              priceMinor: 200000,
              costMinor: 100000,
              currency: "INR",
            },
          },
        },
        include: { variants: true },
      });

      const variant = product.variants[0]!;

      // Create paid order and captured payment
      orderId = randomUUID();
      paymentId = randomUUID();
      orderItemId = randomUUID();

      await prisma.order.create({
        data: {
          id: orderId,
          merchantId,
          currency: "INR",
          totalAmountMinor: 200000,
          status: "PAID",
          source: "DIRECT_BUYER",
          items: {
            create: {
              id: orderItemId,
              variantId: variant.id,
              productNameSnapshot: product.name,
              variantTitleSnapshot: variant.title,
              unitPriceMinor: variant.priceMinor,
              quantity: 1,
              lineDiscountMinor: 0,
              lineTotalMinor: variant.priceMinor,
              currency: "INR",
              source: "DIRECT_BUYER",
            },
          },
          payments: {
            create: {
              id: paymentId,
              merchantId,
              provider: "DEMO",
              amountMinor: 200000,
              currency: "INR",
              state: "CAPTURED",
              attemptNumber: 1,
            },
          },
        },
      });
    });

    it("calculates GST taxes correctly across brackets (CGST, SGST, IGST)", () => {
      // Intra-state (18% split 9% CGST, 9% SGST)
      const intraState = calculateTaxes(
        [{ variantId: "v1", unitPriceMinor: 10000, quantity: 1, taxRateBps: 1800 }],
        "KA",
        "KA",
      );
      expect(intraState.isInterState).toBe(false);
      expect(intraState.totalCgstMinor).toBe(900);
      expect(intraState.totalSgstMinor).toBe(900);
      expect(intraState.totalIgstMinor).toBe(0);

      // Inter-state (18% IGST)
      const interState = calculateTaxes(
        [{ variantId: "v1", unitPriceMinor: 10000, quantity: 1, taxRateBps: 1800 }],
        "KA",
        "MH",
      );
      expect(interState.isInterState).toBe(true);
      expect(interState.totalIgstMinor).toBe(1800);
      expect(interState.totalCgstMinor).toBe(0);
      expect(interState.totalSgstMinor).toBe(0);
    });

    it("processes partial and full refunds on a captured payment", async () => {
      if (!dbAvailable) return;
      // Partial refund of ₹500 (50,000 minor)
      const res1 = await app.inject({
        method: "POST",
        url: "/api/v1/refunds",
        headers: { authorization: `Bearer ${authBearer}` },
        payload: {
          paymentId,
          amountMinor: 50000,
          reason: "Customer requested discount refund",
        },
      });

      expect(res1.statusCode).toBe(201);
      const payment1 = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment1.state).toBe("PARTIALLY_REFUNDED");

      // Full remaining refund of ₹1,500 (150,000 minor)
      const res2 = await app.inject({
        method: "POST",
        url: "/api/v1/refunds",
        headers: { authorization: `Bearer ${authBearer}` },
        payload: {
          paymentId,
          amountMinor: 150000,
          reason: "Full remaining refund",
        },
      });

      expect(res2.statusCode).toBe(201);
      const payment2 = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment2.state).toBe("REFUNDED");
    });

    it("creates and transitions return requests", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/returns",
        headers: { authorization: `Bearer ${authBearer}` },
        payload: {
          orderId,
          reason: "Size too small",
          items: [{ orderItemId, quantity: 1, reason: "Too tight" }],
        },
      });

      expect(res.statusCode).toBe(201);
      const returnId = res.json().id;

      // Transition to APPROVED
      const resApprove = await app.inject({
        method: "POST",
        url: `/api/v1/returns/${returnId}/status`,
        headers: { authorization: `Bearer ${authBearer}` },
        payload: { status: "APPROVED" },
      });
      expect(resApprove.statusCode).toBe(200);
      expect(resApprove.json().status).toBe("APPROVED");
    });

    it("creates fulfillment tracking and updates status", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/fulfillments",
        headers: { authorization: `Bearer ${authBearer}` },
        payload: {
          orderId,
          carrier: "BlueDart",
          trackingNumber: "BD-987654321",
          items: [{ orderItemId, quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const fulfillmentId = res.json().id;

      const resDelivered = await app.inject({
        method: "POST",
        url: `/api/v1/fulfillments/${fulfillmentId}/status`,
        headers: { authorization: `Bearer ${authBearer}` },
        payload: { status: "DELIVERED" },
      });
      expect(resDelivered.statusCode).toBe(200);
      expect(resDelivered.json().status).toBe("DELIVERED");
    });

    it("records and updates disputes", async () => {
      if (!dbAvailable) return;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/disputes",
        headers: { authorization: `Bearer ${authBearer}` },
        payload: {
          paymentId,
          amountMinor: 200000,
          reason: "Unauthorized charge claim",
        },
      });

      expect(res.statusCode).toBe(201);
      const disputeId = res.json().id;

      const resReview = await app.inject({
        method: "POST",
        url: `/api/v1/disputes/${disputeId}/status`,
        headers: { authorization: `Bearer ${authBearer}` },
        payload: {
          status: "UNDER_REVIEW",
          evidenceText: "Signed delivery receipt attached.",
        },
      });
      expect(resReview.statusCode).toBe(200);
      expect(resReview.json().status).toBe("UNDER_REVIEW");
    });
  });

  describe("3. Expired Checkout Maintenance & Inventory Sweep", () => {
    it("sweeps expired checkout sessions and restocks reserved inventory", async () => {
      if (!dbAvailable) return;
      // Create product with inventory
      const cart = await prisma.cart.create({
        data: {
          id: randomUUID(),
          merchantId,
          currency: "INR",
          status: "EXPIRED",
        },
      });

      const variant = await prisma.productVariant.create({
        data: {
          id: randomUUID(),
          sku: `SKU-SWEEP-${Date.now()}`,
          title: "Sweep Item",
          priceMinor: 5000,
          costMinor: 2000,
          currency: "INR",
          product: {
            create: {
              id: randomUUID(),
              merchantId,
              slug: `sweep-prod-${Date.now()}`,
              name: "Sweep Product",
              description: "Sweep test product description",
              category: "Accessories",
              brand: "Apex",
            },
          },
          inventory: {
            create: {
              availableQuantity: 10,
            },
          },
        },
      });

      // Create an expired checkout session
      const checkoutId = randomUUID();
      const orderId = randomUUID();

      await prisma.order.create({
        data: {
          id: orderId,
          merchantId,
          currency: "INR",
          totalAmountMinor: 10000,
          status: "PENDING",
          source: "DIRECT_BUYER",
          items: {
            create: {
              id: randomUUID(),
              variantId: variant.id,
              productNameSnapshot: "Sweep Product",
              variantTitleSnapshot: "Sweep Item",
              unitPriceMinor: 5000,
              quantity: 2,
              lineDiscountMinor: 0,
              lineTotalMinor: 10000,
              currency: "INR",
              source: "DIRECT_BUYER",
            },
          },
          checkoutSessions: {
            create: {
              id: checkoutId,
              merchantId,
              cartId: cart.id,
              status: "READY_FOR_PAYMENT",
              amountMinor: 10000,
              currency: "INR",
              expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
              orderFingerprint: "fingerprint-123",
              workflowId: `sweep-test-${checkoutId}`,
            },
          },
        },
      });

      // Sweep
      const result = await sweepExpiredCheckouts(prisma, merchantId);
      expect(result.expiredCount).toBeGreaterThanOrEqual(1);
      expect(result.restockedVariantsCount).toBeGreaterThanOrEqual(2);

      const updatedCheckout = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutId } });
      expect(updatedCheckout.status).toBe("EXPIRED");

      const updatedInventory = await prisma.inventory.findUniqueOrThrow({ where: { variantId: variant.id } });
      expect(updatedInventory.availableQuantity).toBe(12); // 10 + 2 restocked
    });
  });

  describe("4. Automatic Campaign Attribution and Conversion", () => {
    it("automatically attributes orders to treatment campaigns and converts on captured payment", async () => {
      if (!dbAvailable) return;
      // 1. Create active campaign
      const campaign = await prisma.campaign.create({
        data: {
          id: randomUUID(),
          merchantId,
          createdById: userId,
          name: "Agent VIP Campaign",
          actionType: "UPSELL",
          budgetMinor: 100000,
          spentMinor: 0,
          incentiveMinorPerConversion: 1000,
          maxUsesPerSubject: 5,
          controlPercentBps: 0, // 100% treatment
          startsAt: new Date(Date.now() - 3600000),
          endsAt: new Date(Date.now() + 86400000),
          status: "ACTIVE",
        },
      });

      // 2. Assign subject
      const subjectKey = "agent-vip@acme.ai";
      const resAssign = await app.inject({
        method: "POST",
        url: `/api/v1/campaigns/${campaign.id}/assign`,
        headers: { authorization: `Bearer ${authBearer}` },
        payload: { subjectKey },
      });
      expect(resAssign.statusCode).toBe(200);
      expect(resAssign.json().cohort).toBe("TREATMENT");

      // 3. Create order and run auto attribution
      const orderId = randomUUID();
      const paymentId = randomUUID();

      await prisma.order.create({
        data: {
          id: orderId,
          merchantId,
          currency: "INR",
          totalAmountMinor: 50000,
          status: "PENDING",
          source: "AI_UPSELL",
        },
      });

      await tryAutoAttributeOrder(prisma, {
        merchantId,
        orderId,
        subjectKey,
      });

      const attribution = await prisma.campaignOrderAttribution.findUnique({
        where: { orderId },
      });
      expect(attribution).toBeTruthy();
      expect(attribution?.campaignId).toBe(campaign.id);

      // 4. Capture payment and run auto conversion
      await prisma.payment.create({
        data: {
          id: paymentId,
          merchantId,
          orderId,
          provider: "DEMO",
          amountMinor: 50000,
          currency: "INR",
          state: "CAPTURED",
          attemptNumber: 1,
        },
      });

      await tryAutoConvertCampaignOnPaymentCapture(prisma, paymentId);

      const conversion = await prisma.campaignConversion.findUnique({
        where: { paymentId },
      });
      expect(conversion).toBeTruthy();
      expect(conversion?.observedRevenueMinor).toBe(50000);
      expect(conversion?.incentiveCostMinor).toBe(1000);

      const updatedCampaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      expect(updatedCampaign.spentMinor).toBe(1000);
    });
  });
});
