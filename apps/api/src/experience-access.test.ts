import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db/client.js";
import { hashPassword } from "./modules/auth/password.js";
import { getTestMerchantId } from "./test-helpers/test-app.js";

let app: FastifyInstance;
const suffix = randomUUID();
const password = "AccessTest!2026";
let customerToken: string;
let adminToken: string;
let customerId: string;
let adminId: string;
beforeAll(async () => {
  app = buildApp(); await app.ready();
  const merchantId = await getTestMerchantId(prisma);
  const passwordHash = await hashPassword(password);
  customerId = (await prisma.merchantUser.create({ data: { merchantId, email: `customer-${suffix}@example.test`, passwordHash, role: "CUSTOMER" } })).id;
  adminId = (await prisma.merchantUser.create({ data: { merchantId, email: `admin-${suffix}@example.test`, passwordHash, role: "PLATFORM_ADMIN" } })).id;
  const customer = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: `customer-${suffix}@example.test`, password, experience: "customer" } });
  const admin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: `admin-${suffix}@example.test`, password, experience: "admin" } });
  expect(customer.statusCode).toBe(200); expect(admin.statusCode).toBe(200);
  customerToken = customer.json().token; adminToken = admin.json().token;
});
afterAll(async () => {
  if (customerId && adminId) await prisma.merchantUser.deleteMany({ where: { id: { in: [customerId, adminId] } } });
  await app?.close(); await prisma.$disconnect();
});
describe("server-enforced experience roles", () => {
  it("rejects customer credentials on the administrator login", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: `customer-${suffix}@example.test`, password, experience: "admin" } });
    expect(response.statusCode).toBe(403);
  });
  it("blocks customers from merchant and platform data", async () => {
    for (const url of ["/api/v1/merchant", "/api/v1/admin/users", "/api/v1/admin/payments"]) {
      expect((await app.inject({ url, headers: { authorization: `Bearer ${customerToken}` } })).statusCode).toBe(403);
    }
  });
  it("permits customer marketplace discovery and private purchase history", async () => {
    for (const url of ["/api/v1/marketplace/discovery", "/api/v1/buyer/purchase-proposals"]) {
      expect((await app.inject({ url, headers: { authorization: `Bearer ${customerToken}` } })).statusCode).toBe(200);
    }
  });
  it("allows platform-wide admin views without exposing password hashes", async () => {
    const response = await app.inject({ url: "/api/v1/admin/users", headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.some((user: { id: string }) => user.id === customerId)).toBe(true);
    expect(response.body).not.toContain("passwordHash");
  });
  it("allows only platform administrators to run the failure-first evidence demo", async () => {
    const customer = await app.inject({ method: "POST", url: "/api/v1/admin/risk/failure-first", headers: { authorization: `Bearer ${customerToken}` } });
    expect(customer.statusCode).toBe(403);
    const admin = await app.inject({ method: "POST", url: "/api/v1/admin/risk/failure-first", headers: { authorization: `Bearer ${adminToken}` } });
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toMatchObject({ classification: "DEBIT_CREDIT_MISMATCH", automaticRetry: "BLOCKED", nextAction: "INVESTIGATION_AND_RECONCILIATION_REQUIRED" });
  });
});
