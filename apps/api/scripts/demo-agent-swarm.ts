/**
 * The five-intent live demo from BRIEF.md §5.
 *
 * Drives FIVE simulated buyer agents against a running Anumati gateway
 * over real HTTP — three clean auto-approvals across three different
 * protocols, one negotiated upsell, and one engineered to be refused on
 * stage.
 *
 * WHAT IS REAL HERE
 *
 * The protocol payloads, the Ed25519 mandate signing, the HTTP calls and
 * every decision are real. This script holds the BUYER's private keys,
 * which is exactly right: a spend mandate is the buyer's consent, so the
 * buyer signs it. The gateway verifies with the public key it is handed
 * and has no ability to mint one.
 *
 * WHAT IS NOT
 *
 * These are scripted agents, not ChatGPT/Gemini/an x402 wallet actually
 * calling in. They exercise the real adapters with spec-shaped payloads;
 * they are not evidence that a live counterparty has been certified
 * against this gateway. AP2 and x402 remain compatibility shims, and this
 * script prints that on every run rather than letting a demo imply
 * otherwise.
 *
 * Run: pnpm demo:agent-swarm
 */
import { generateKeyPairSync, sign as edSign, randomUUID } from "node:crypto";
import { mandateSigningPayload, type SpendMandate } from "@razorgrowth/domain";

const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EMAIL = process.env.DEMO_EMAIL ?? "owner@meridianathletics.demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "MeridianDemo!2026";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const RAW_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

function log(step: string, detail: string) {
  console.log(`  ${step.padEnd(22)} ${detail}`);
}
function heading(text: string) {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

let token = "";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface GatewayResult {
  outcome: string;
  reasonCode: string;
  explanation: string;
  protocol: string | null;
  protocolFidelity: string | null;
  computedTotalMinor: number | null;
  decisionLatencyMs: number;
  stepUpUrl: string | null;
  offer: { addSkus: string[]; discountBps: number; pitch: string } | null;
}

async function submitIntent(
  merchantSlug: string,
  agentId: string,
  body: Record<string, unknown>,
  protocolHeader?: string,
): Promise<{ status: number; result: GatewayResult }> {
  const res = await fetch(`${API}/agent-gateway/${merchantSlug}/intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-id": agentId,
      ...(protocolHeader ? { "x-agent-protocol": protocolHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, result: (await res.json()) as GatewayResult };
}

function mandate(merchantId: string, agentId: string, maxAmountMinor: number): Record<string, unknown> {
  const now = Date.now();
  const terms: Omit<SpendMandate, "signature" | "publicKey"> = {
    mandateId: randomUUID(),
    buyerAgentId: agentId,
    merchantScope: merchantId,
    maxAmountMinor,
    currency: "INR",
    notBefore: new Date(now - 60_000),
    expiresAt: new Date(now + 900_000),
    nonce: randomUUID(),
  };
  const signature = edSign(null, Buffer.from(mandateSigningPayload(terms), "utf8"), privateKey).toString("base64");
  return {
    ...terms,
    notBefore: terms.notBefore.toISOString(),
    expiresAt: terms.expiresAt.toISOString(),
    publicKey: RAW_PUBLIC_KEY,
    signature,
  };
}

function rupees(minor: number | null): string {
  return minor === null ? "—" : `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function report(label: string, status: number, result: GatewayResult) {
  const mark = result.outcome === "AUTO_APPROVE" ? "✓" : result.outcome === "STEP_UP" ? "↳" : "✕";
  console.log(`\n${mark} ${label}`);
  log("protocol", `${result.protocol ?? "unreadable"}${result.protocolFidelity ? ` (${result.protocolFidelity})` : ""}`);
  log("http / outcome", `${status} · ${result.outcome} · ${result.reasonCode}`);
  log("basket (our price)", rupees(result.computedTotalMinor));
  log("latency", `${result.decisionLatencyMs}ms`);
  if (result.offer) log("negotiator", `+${result.offer.addSkus.join(", ")} at ${result.offer.discountBps / 100}% off`);
  if (result.stepUpUrl) log("step-up link", result.stepUpUrl);
  console.log(`  reason → "${result.explanation}"`);
}

async function main() {
  console.log("Anumati — five simulated buyer agents against a live gateway");
  console.log(`API: ${API}`);

  heading("0. Setup");
  const auth = await api<{ token: string }>("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  token = auth.token;
  const merchant = await api<{ id: string; slug: string; name: string }>("GET", "/merchant");
  log("merchant", `${merchant.name} (${merchant.slug})`);

  interface CatalogVariant {
    sku: string;
    price: { amountMinor: number };
    availability: { state: string };
  }
  const catalog = await api<{ items: { id: string; name: string; category: string; variants: CatalogVariant[] }[] }>(
    "GET",
    "/agent-commerce/catalog?limit=50",
  );

  // Pick a variant that is genuinely purchasable. The catalogue includes
  // discontinued variants on purpose (an agent should be able to see that
  // something exists but cannot be bought), so taking the first one blindly
  // gets a deactivated SKU and the gateway correctly refuses it.
  const purchasable = catalog.items
    .flatMap((p) => p.variants.map((v) => ({ product: p, variant: v })))
    .filter(({ variant }) => ["IN_STOCK", "LOW_STOCK"].includes(variant.availability.state));

  if (purchasable.length === 0) throw new Error("No purchasable variant in the catalogue — has the seed been run?");

  const chosen =
    purchasable.find(({ variant }) => variant.price.amountMinor < 500_000) ?? purchasable[0]!;
  const cheapSku = chosen.variant.sku;
  const cheapPrice = chosen.variant.price.amountMinor;
  log("test SKU", `${cheapSku} @ ${rupees(cheapPrice)} (${chosen.variant.availability.state})`);

  await api("PUT", "/agent-gateway/policy", {
    unknownAgentCeilingMinor: 1_000_000,
    knownAgentCeilingMinor: 5_000_000,
    blockedCategories: [],
    maxNegotiationDiscountBps: 1000,
    velocityMaxIntentsPerHour: 100,
  }).catch(() => log("policy", "using existing gateway policy"));

  heading("1-3. Three protocols, three clean approvals");

  const acp = await submitIntent(merchant.slug, "agent-chatgpt-acp", {
    items: [{ id: cheapSku, quantity: 1 }],
    buyer: { email: "buyer@agent.test" },
    totals: { total: cheapPrice },
    anumati_mandate: mandate(merchant.id, "agent-chatgpt-acp", 2_000_000),
  });
  report("ACP agent — everyday basket", acp.status, acp.result);

  const ap2 = await submitIntent(merchant.slug, "agent-gemini-ap2", {
    agent_id: "agent-gemini-ap2",
    cart_mandate: {
      id: randomUUID(),
      contents: {
        payment_request: {
          details: {
            displayItems: [{ sku: cheapSku, quantity: 1 }],
            total: { amount: { currency: "INR", value: (cheapPrice / 100).toFixed(2) } },
          },
        },
      },
    },
    anumati_mandate: mandate(merchant.id, "agent-gemini-ap2", 2_000_000),
  });
  report("AP2 agent — same basket, different dialect", ap2.status, ap2.result);

  const x402 = await submitIntent(merchant.slug, "agent-x402-wallet", {
    x402Version: 1,
    currency: "INR",
    items: [{ sku: cheapSku, quantity: 1 }],
    payload: { authorization: { value: String(cheapPrice) } },
    anumati_mandate: mandate(merchant.id, "agent-x402-wallet", 2_000_000),
  });
  report("x402 agent — autonomous wallet", x402.status, x402.result);

  heading("4. Negotiated upsell");
  const upsell = await submitIntent(merchant.slug, "agent-negotiation-test", {
    items: [{ id: cheapSku, quantity: 2 }],
    buyer: {},
    totals: { total: cheapPrice * 2 },
    anumati_mandate: mandate(merchant.id, "agent-negotiation-test", 3_000_000),
  });
  report("ACP agent — negotiator offers an add-on", upsell.status, upsell.result);
  if (!upsell.result.offer) {
    log("note", "no complement available in this catalogue — the negotiator declined, which is a valid answer");
  }

  heading("5. The refusal — shown, not edited out");
  const bigQuantity = Math.ceil(4_800_000 / cheapPrice);
  const bigTotal = cheapPrice * bigQuantity;
  // The mandate is issued TO this agent, so the id must match the caller —
  // a mismatch is its own (correct) refusal and would mask the ceiling
  // breach this scenario is meant to show.
  const unknownAgentId = `agent-unregistered-${randomUUID().slice(0, 8)}`;
  const declined = await submitIntent(merchant.slug, unknownAgentId, {
    items: [{ id: cheapSku, quantity: bigQuantity }],
    buyer: {},
    totals: { total: bigTotal },
    anumati_mandate: mandate(merchant.id, unknownAgentId, bigTotal + 1),
  });
  report("Unregistered ACP agent — far over the ceiling", declined.status, declined.result);

  heading("Measurement (this run)");
  const metrics = await api<Record<string, unknown>>("GET", "/agent-gateway/metrics");
  log("total decisions", String(metrics.totalDecisions));
  log("auto-approval rate", `${metrics.autoApprovalRatePct ?? "—"}%`);
  log("median latency", `${metrics.medianDecisionLatencyMs ?? "—"}ms`);
  log("decisions w/ reason", `${metrics.decisionsWithWrittenReasonPct ?? "—"}%`);
  log("negotiator AOV lift", metrics.negotiatorAovLiftPct === null ? "not computable from this run" : `${metrics.negotiatorAovLiftPct}%`);

  console.log(`\n  basis: ${String(metrics.basis)}`);
  console.log("\nHONESTY: these are scripted agents exercising the real adapters, not");
  console.log("live ChatGPT / Gemini / x402 counterparties. ACP follows the published");
  console.log("spec; AP2 and x402 are compatibility shims and are labelled as such in");
  console.log("every response above.\n");
}

main().catch((err) => {
  console.error("Swarm failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
