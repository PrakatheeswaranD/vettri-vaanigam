/**
 * System capability summary (productization pass — "AI Growth &
 * Agentic Commerce" positioning). Every field is computed from the same
 * merchant-scoped data and services every other route already reads —
 * this is a read model over existing truth, never a new source of truth
 * or a static marketing claim.
 */
import type { PrismaClient } from "@prisma/client";
import type { ConnectedSystemsDTO, SystemCapabilitiesDTO } from "@razorgrowth/contracts";
import { getPaymentGateway } from "../payments/gateway-factory.js";
import { getAIProvider } from "../agents/provider-factory.js";

export async function getSystemCapabilities(prisma: PrismaClient, merchantId: string): Promise<SystemCapabilitiesDTO> {
  const [activeProductCount, growthConfig, policy] = await Promise.all([
    prisma.product.count({ where: { merchantId, status: "ACTIVE" } }),
    prisma.merchantGrowthConfig.findUnique({ where: { merchantId } }),
    prisma.merchantPolicy.findUnique({ where: { merchantId } }),
  ]);

  const gateway = getPaymentGateway();
  const paymentProvider: SystemCapabilitiesDTO["paymentProvider"] =
    gateway === null ? "NOT_CONFIGURED" : gateway.provider === "RAZORPAY" ? "RAZORPAY_TEST_MODE" : "MOCK_GATEWAY";

  const catalogReady = activeProductCount > 0;

  return {
    buyerDiscovery: catalogReady ? "READY" : "NOT_READY",
    catalogGrounding: catalogReady ? "READY" : "NOT_READY",
    growthIntelligence: growthConfig?.growthActionsEnabled ? "READY" : "NOT_READY",
    policy: policy ? "ENFORCING" : "NOT_CONFIGURED",
    checkout: paymentProvider !== "NOT_CONFIGURED" ? "READY" : "NOT_READY",
    paymentProvider,
    recovery: policy && policy.maxRecoveryAttempts > 0 ? "READY" : "NOT_READY",
    ledger: "ENABLED",
  };
}

/**
 * Connected commerce systems (Part 11 §7). Reports what genuinely feeds
 * this build — no fabricated third-party connectors, and `CONNECTED`
 * only when rows actually exist for this merchant.
 */
export async function getConnectedSystems(prisma: PrismaClient, merchantId: string): Promise<ConnectedSystemsDTO> {
  const [products, variants, orders, checkouts] = await Promise.all([
    prisma.product.count({ where: { merchantId } }),
    prisma.productVariant.count({ where: { product: { merchantId } } }),
    prisma.order.count({ where: { merchantId } }),
    prisma.checkoutSession.count({ where: { merchantId } }),
  ]);

  const gateway = getPaymentGateway();
  const paymentProvider: ConnectedSystemsDTO["paymentProvider"] =
    gateway === null ? "NOT_CONFIGURED" : gateway.provider === "RAZORPAY" ? "RAZORPAY_TEST_MODE" : "MOCK_GATEWAY";

  const status = (count: number) => (count > 0 ? ("CONNECTED" as const) : ("NO_DATA" as const));

  return {
    source: "Merchant Commerce Data",
    catalog: status(products),
    inventory: status(variants),
    orders: status(orders),
    checkout: status(checkouts),
    paymentProvider,
    aiProvider: getAIProvider().mode,
    counts: { products, variants, orders, checkouts },
  };
}
