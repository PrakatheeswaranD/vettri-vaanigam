import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), aggregate: vi.fn(), update: vi.fn(), policyUpdate: vi.fn(), execute: vi.fn(), getPayment: vi.fn(), verify: vi.fn() }));
vi.mock("./db/client.js", () => ({ prisma: {
  decisionRecord: { findFirst: mocks.findFirst, findUniqueOrThrow: mocks.findUniqueOrThrow, aggregate: mocks.aggregate, update: mocks.update },
  buyerSpendingPolicy: { update: mocks.policyUpdate },
} }));
vi.mock("./modules/audit/ledger.js", async () => {
  const { prisma } = await import("./db/client.js");
  return { withLedgerConcurrencyRetry: (_db: unknown, callback: (tx: unknown) => unknown) => callback(prisma), appendLedgerEvent: vi.fn() };
});
vi.mock("./modules/gateway/execution-service.js", () => ({ executeExternalAgentPurchase: mocks.execute, ExternalPurchaseExecutionError: class extends Error {} }));
vi.mock("./modules/payments/payment-service.js", () => ({ getPayment: mocks.getPayment, verifyClientCompletion: mocks.verify }));
import { registerBuyerPurchaseRoutes } from "./modules/buyer-policy/purchase-routes.js";
import { AppError } from "./http/errors.js";

const id = "11111111-1111-4111-8111-111111111111";
const proposal = { id, merchantId: "seller", internalPaymentId: null, normalizedBasket: [{ productId: id, variantId: id, quantity: 1, unitPriceMinor: 100 }], settlementStatus: "PROPOSED", outcome: "AUTO_APPROVE", authorizationExpiresAt: new Date(Date.now() + 600_000) };
let app: FastifyInstance;
let role = "OWNER";
beforeEach(async () => {
  vi.clearAllMocks();
  role = "OWNER";
  app = Fastify();
  app.addHook("preHandler", async (request) => { request.merchantId = "buyer"; request.merchantUserRole = role; });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ message: error instanceof Error ? error.message : "Unknown error" }));
  registerBuyerPurchaseRoutes(app, "/api/v1");
  await app.ready();
  mocks.findFirst.mockResolvedValue(proposal);
  mocks.policyUpdate.mockResolvedValue({});
});
afterEach(async () => { await app.close(); });

describe("buyer purchase authorization guards", () => {
  it("rejects a viewer before querying or executing a proposal", async () => {
    role = "VIEWER";
    const response = await app.inject({ method: "POST", url: `/api/v1/buyer/purchase-proposals/${id}/authorize` });
    expect(response.statusCode).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("scopes ownership to the authenticated buyer context", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: `/api/v1/buyer/purchase-proposals/${id}/payment` });
    expect(response.statusCode).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id, externalAgentId: "customer-buyer-agent", protocolActorRef: "buyer" } });
  });
  it("does not execute an already in-flight proposal", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({ ...proposal, settlementStatus: "EXECUTING" });
    const response = await app.inject({ method: "POST", url: `/api/v1/buyer/purchase-proposals/${id}/authorize` });
    expect(response.statusCode).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects expired authorization", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({ ...proposal, authorizationExpiresAt: new Date(0) });
    const response = await app.inject({ method: "POST", url: `/api/v1/buyer/purchase-proposals/${id}/authorize` });
    expect(response.statusCode).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("returns existing evidence without executing a replay", async () => {
    mocks.findFirst.mockResolvedValue({ ...proposal, internalPaymentId: id });
    mocks.getPayment.mockResolvedValue({ id, state: "CREATED" });
    const response = await app.inject({ method: "POST", url: `/api/v1/buyer/purchase-proposals/${id}/authorize` });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("CREATED");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects verification for an unrelated payment", async () => {
    const response = await app.inject({ method: "POST", url: `/api/v1/buyer/purchase-proposals/${id}/payment/verify`, payload: { paymentId: id, razorpayOrderId: "order", razorpayPaymentId: "payment", razorpaySignature: "signature" } });
    expect(response.statusCode).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
