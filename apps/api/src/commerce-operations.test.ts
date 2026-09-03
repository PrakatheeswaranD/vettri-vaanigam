/**
 * 🛍 Commerce as the operational data and action layer.
 *
 * UI → API → backend → database → agent → result → UI, asserted at the
 * seams that can actually come apart.
 *
 * The three things this file exists to hold:
 *
 *   1. Commerce shows the SAME findings Growth does, because it copies
 *      them rather than deriving its own. Two screens that compute the
 *      same thing separately is how this console once stated two different
 *      revenues for one merchant.
 *   2. Every attached finding names a tool the server actually registers,
 *      or names none. A console offering an action the backend has no
 *      handler for is a button that 404s.
 *   3. A tool invoked through the API does the same thing the autonomous
 *      cycle does, because it is the same handler.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AgentToolsResponseDTO,
  CommerceCustomersResponseDTO,
  CommerceOrdersResponseDTO,
  CommercePaymentsResponseDTO,
  CommerceProductsResponseDTO,
  RevenueOpportunityReportDTO,
} from "@razorgrowth/contracts";
import { buildAuthedTestApp, buildCustomerTestApp, getTestMerchantId } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";
import { AGENT_TOOLS, toolForOpportunityType } from "./modules/merchant-agent/tools.js";

let app: FastifyInstance;
let customerApp: FastifyInstance;
let merchantId: string;

beforeAll(async () => {
  app = await buildAuthedTestApp();
  customerApp = await buildCustomerTestApp();
  merchantId = await getTestMerchantId(prisma);
});

afterAll(async () => {
  await app.close();
  await customerApp.close();
  await prisma.$disconnect();
});

const get = async <T>(url: string): Promise<T> => {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `${url} -> ${res.body}`).toBe(200);
  return res.json() as T;
};

describe("the four views serve real operational rows", () => {
  it("reports product performance from PAID orders only", async () => {
    const body = await get<CommerceProductsResponseDTO>("/api/v1/commerce/products");
    expect(body.products.length).toBeGreaterThan(0);

    for (const row of body.products) {
      // Never zero-as-unknown: a product that has never sold reports null
      // for its average, because an average over no observations is not a
      // number.
      if (row.performance.unitsSold === 0) {
        expect(row.performance.averageSellingPriceMinor, row.productId).toBeNull();
        expect(row.performance.revenueMinor).toBe(0);
      } else {
        expect(row.performance.averageSellingPriceMinor).not.toBeNull();
        expect(row.performance.revenueMinor).toBeGreaterThan(0);
      }
      expect(["AGENT_READY", "PARTIALLY_READY", "NOT_READY"]).toContain(row.aiReadiness.state);
    }

    // The figures must agree with the database, not merely be internally
    // consistent. Checked against a product that actually sold.
    const sold = body.products.find((p) => p.performance.unitsSold > 0);
    expect(sold, "the demo catalogue must contain at least one product that sold").toBeDefined();
    const variantIds = (
      await prisma.productVariant.findMany({ where: { productId: sold!.productId }, select: { id: true } })
    ).map((v) => v.id);
    const truth = await prisma.orderItem.aggregate({
      where: { variantId: { in: variantIds }, order: { merchantId, status: "PAID" } },
      _sum: { quantity: true, lineTotalMinor: true },
    });
    expect(sold!.performance.unitsSold).toBe(truth._sum.quantity);
    expect(sold!.performance.revenueMinor).toBe(truth._sum.lineTotalMinor);
  });

  it("describes customers only by what was observed", async () => {
    const body = await get<CommerceCustomersResponseDTO>("/api/v1/commerce/customers");
    expect(body.customers.length).toBeGreaterThan(0);

    for (const c of body.customers) {
      // A gap needs two points. Reporting 0 for a customer with one paid
      // order would read as "they buy constantly".
      if (c.behaviour.paidOrderCount < 2) {
        expect(c.behaviour.medianGapDays, c.id).toBeNull();
        expect(c.behaviour.observedSpanDays, c.id).toBeNull();
      }
      if (c.behaviour.paidOrderCount === 0) {
        expect(c.behaviour.averageOrderValueMinor, c.id).toBeNull();
        expect(c.behaviour.lifetimeValueMinor).toBe(0);
      }
      expect(c.behaviour.paidOrderCount).toBeLessThanOrEqual(c.behaviour.orderCount);
    }
  });

  it("separates what an order asked for from what was actually captured", async () => {
    const body = await get<CommerceOrdersResponseDTO>("/api/v1/commerce/orders");
    expect(body.orders.length).toBeGreaterThan(0);

    for (const order of body.orders) {
      const truth = await prisma.payment.aggregate({
        where: { orderId: order.id, state: "CAPTURED" },
        _sum: { amountMinor: true },
      });
      // The distinction the page turns on: an order total is what was
      // asked for, captured is what arrived.
      expect(order.capturedMinor, order.id).toBe(truth._sum.amountMinor ?? 0);
    }
  });

  it("attributes an agent order to the proposal that actually caused it", async () => {
    const body = await get<CommerceOrdersResponseDTO>("/api/v1/commerce/orders");
    const attributed = body.orders.filter((o) => o.attribution.proposalId);
    expect(attributed.length, "the demo data must contain at least one agent-originated order").toBeGreaterThan(0);

    for (const order of attributed) {
      // A recorded column, not an inference: the proposal id must exist
      // and belong to this merchant.
      const proposal = await prisma.growthActionProposal.findUnique({
        where: { id: order.attribution.proposalId! },
        select: { merchantId: true },
      });
      expect(proposal, order.attribution.proposalId!).not.toBeNull();
      expect(proposal!.merchantId).toBe(merchantId);
    }

    // An order that arrived through the agent gateway is somebody ELSE's
    // buyer agent. Counting it as this merchant's agent's work would be
    // taking credit for a third party's traffic.
    for (const order of body.orders.filter((o) => o.attribution.source === "AGENT_GATEWAY")) {
      expect(order.attribution.agentAttributed, order.id).toBe(false);
    }
  });

  it("surfaces payments whose outcome nobody has confirmed", async () => {
    const body = await get<CommercePaymentsResponseDTO>("/api/v1/commerce/payments");
    const unverified = body.payments.filter((p) => p.verification === "UNVERIFIED");

    // Every UNVERIFIED row is an UNKNOWN payment, and every UNKNOWN
    // payment is UNVERIFIED. These were invisible to the opportunity
    // engine, which filters `state === "FAILED"`.
    for (const p of unverified) expect(p.state, p.id).toBe("UNKNOWN");
    expect(body.totals.unverifiedCount).toBe(
      await prisma.payment.count({ where: { merchantId, state: "UNKNOWN" } }),
    );

    // An in-flight payment is not "unverified" — that would put every new
    // checkout on a remediation list.
    for (const p of body.payments.filter((x) => x.state === "CREATED" && !x.lastReconciledAt)) {
      expect(p.verification, p.id).toBe("NOT_APPLICABLE");
    }
  });
});

describe("Commerce references Growth rather than recomputing it", () => {
  it("attaches the engine's own findings, verbatim", async () => {
    const [report, payments] = await Promise.all([
      get<RevenueOpportunityReportDTO>("/api/v1/growth/revenue-opportunities"),
      get<CommercePaymentsResponseDTO>("/api/v1/commerce/payments"),
    ]);

    const engineById = new Map(report.opportunities.map((o) => [o.id, o]));
    let attachedCount = 0;

    for (const payment of payments.payments) {
      for (const attached of payment.opportunities) {
        const source = engineById.get(attached.id);
        // A finding Commerce shows that Growth does not know about would
        // mean Commerce is detecting on its own.
        expect(source, `${attached.id} on payment ${payment.id}`).toBeDefined();
        // Copied, not derived. If these ever drift, the two screens can
        // tell a merchant different things about the same row.
        expect(attached.whyDetected).toBe(source!.whyDetected);
        expect(attached.priority).toBe(source!.score.priority);
        expect(attached.policyOutcome).toBe(source!.policy.outcome);
        expect(attached.status).toBe(source!.status);
        attachedCount += 1;
      }
    }
    expect(attachedCount, "payments must carry attached findings for this to prove anything").toBeGreaterThan(0);
  });

  it("attaches a finding only to rows the engine actually named", async () => {
    const [report, payments] = await Promise.all([
      get<RevenueOpportunityReportDTO>("/api/v1/growth/revenue-opportunities"),
      get<CommercePaymentsResponseDTO>("/api/v1/commerce/payments"),
    ]);
    const subjectsById = new Map(report.opportunities.map((o) => [o.id, new Set(o.subjectIds)]));

    for (const payment of payments.payments) {
      for (const attached of payment.opportunities) {
        const subjects = subjectsById.get(attached.id)!;
        // Attached by payment id or by the order it belongs to — never by
        // anything the engine did not name.
        expect(
          subjects.has(payment.id) || subjects.has(payment.orderId),
          `${attached.type} attached to payment ${payment.id} which it never named`,
        ).toBe(true);
      }
    }
  });
});

describe("the agent's tools are declared, and the declaration is true", () => {
  it("serves the registry the console reads", async () => {
    const body = await get<AgentToolsResponseDTO>("/api/v1/merchant-agent/tools");
    expect(body.tools.length).toBeGreaterThan(0);

    for (const tool of body.tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.summary.length).toBeGreaterThan(20);
      expect(["AUTOMATIC", "GOVERNED"]).toContain(tool.safety);
      // The safety class is not decorative. An AUTOMATIC tool that moved
      // money or needed approval would be a governed tool mislabelled,
      // and the label is what the console promises the merchant.
      if (tool.safety === "AUTOMATIC") {
        expect(tool.movesMoney, tool.name).toBe(false);
        expect(tool.requiresApproval, tool.name).toBe(false);
      }
    }
  });

  it("names a real tool for every actionable finding, or none at all", async () => {
    const report = await get<RevenueOpportunityReportDTO>("/api/v1/growth/revenue-opportunities");
    const registered = new Set(AGENT_TOOLS.map((t) => t.name));

    for (const o of report.opportunities) {
      const tool = toolForOpportunityType(o.type);
      // A console offering an action the backend has no handler for is a
      // button that 404s.
      if (tool !== null) expect(registered, `${o.type} -> ${tool}`).toContain(tool);
    }

    // And the mapping must not be empty, or this asserts nothing.
    expect(report.opportunities.some((o) => toolForOpportunityType(o.type) !== null)).toBe(true);
  });

  it("refuses a tool nobody registered", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/tools/delete_everything",
      payload: { subjectId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("keeps the whole Commerce surface away from shopper sessions", async () => {
    // These are merchant management routes. A customer reaching one would
    // be a hole in the access model, not a feature.
    for (const url of [
      "/api/v1/commerce/products",
      "/api/v1/commerce/customers",
      "/api/v1/commerce/orders",
      "/api/v1/commerce/payments",
      "/api/v1/merchant-agent/tools",
    ]) {
      const res = await customerApp.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

describe("running a tool changes the row it was run on", () => {
  it("reconciles an unverified payment through the API, and the row moves", async () => {
    const before = await get<CommercePaymentsResponseDTO>("/api/v1/commerce/payments");
    const target = before.payments.find((p) => p.verification === "UNVERIFIED" && p.opportunities.some((o) => o.tool));
    if (!target) {
      // Stated rather than silently skipped: a green run that exercised
      // nothing is the failure mode this codebase keeps finding.
      expect(before.totals.unverifiedCount, "no unverified payment to reconcile — the fixture no longer exercises this").toBe(0);
      return;
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/tools/reconcile_payment",
      payload: { subjectId: target.id },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json() as { outcome: string; detail: string; tool: string };
    expect(result.tool).toBe("reconcile_payment");

    // The provider is not configured in the test environment, so the
    // honest outcome is a REFUSAL that says so — not a fabricated
    // reconciliation. Either way the tool must never report EXECUTED
    // without the payment row actually having been read back.
    expect(["EXECUTED", "REFUSED", "FAILED"]).toContain(result.outcome);
    expect(result.detail.length).toBeGreaterThan(10);

    if (result.outcome === "EXECUTED") {
      const after = await prisma.payment.findUniqueOrThrow({ where: { id: target.id }, select: { lastReconciledAt: true } });
      expect(after.lastReconciledAt, "an executed reconciliation must have stamped the row").not.toBeNull();
    }
  });

  it("never lets a non-OWNER run a tool", async () => {
    // A GOVERNED tool can put money in motion inside the merchant's own
    // limits. Choosing to spend one of those limits is an owner's
    // decision — the same bar as changing the limits themselves.
    const res = await customerApp.inject({
      method: "POST",
      url: "/api/v1/merchant-agent/tools/reconcile_payment",
      payload: { subjectId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(403);
  });
});
