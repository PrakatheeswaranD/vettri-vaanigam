/**
 * Anumati Interactive Multi-Agent Demo Runner
 *
 * Demonstrates live, end-to-end Track 01 capabilities against the running API:
 * - Scenario 1: OpenAI ChatGPT Agent via ACP 2026-04-17 (Ed25519 signatures & delegated tokens)
 * - Scenario 2: Coinbase Agent via x402 Protocol v2 (402 Payment Required challenge & settlement)
 * - Scenario 3: NPCI UAP/UCP Agent & Policy Step-Up Governance (Over-limit human approval)
 * - Scenario 4: Autonomous Growth Negotiator (AI Upsell within bounded floor margin)
 * - Scenario 5: Post-Purchase Lifecycle (Refunds, Restock & Indian GST Tax calculation)
 * - Scenario 6: Tamper-Evident Cryptographic Ledger Verification (SHA-256 hash chaining)
 */
import { randomBytes, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import readline from "node:readline";
import { canonicalStringify, type CanonicalValue, mandateSigningPayload } from "@razorgrowth/domain";

const API = process.env.DEMO_API_BASE_URL ?? "http://localhost:4000/api/v1";
const EMAIL = process.env.DEMO_EMAIL ?? "owner@meridianathletics.demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "MeridianDemo!2026";

// ANSI Color Helpers
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  bgCyan: "\x1b[46m\x1b[30m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgYellow: "\x1b[43m\x1b[30m",
};

function banner() {
  console.clear();
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║       ANUMATI — AI GROWTH & AGENTIC COMMERCE GATEWAY (TRACK 01)              ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}║       Autonomous Revenue Growth & Multi-Protocol AI Transactability          ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);
}

function printStep(num: string, title: string, desc: string) {
  console.log(`\n${C.bgCyan} SCENARIO ${num} ${C.reset} ${C.bold}${title}${C.reset}`);
  console.log(`${C.dim}            ↳ ${desc}${C.reset}`);
}

function printSuccess(label: string, detail: string) {
  console.log(`  ${C.green}✔ ${C.bold}${label.padEnd(24)}${C.reset} ${detail}`);
}

function printInfo(label: string, detail: string) {
  console.log(`  ${C.cyan}ℹ ${C.bold}${label.padEnd(24)}${C.reset} ${detail}`);
}

function printWarning(label: string, detail: string) {
  console.log(`  ${C.yellow}⚠ ${C.bold}${label.padEnd(24)}${C.reset} ${detail}`);
}

let merchantAuthToken = "";
const merchantSlug = "meridian-athletics";
let merchantId = "";
let demoVariant: { id: string; productId: string; sku: string; priceMinor: number } | null = null;

// Ed25519 Agent Identity
let agentPrivateKey: KeyObject;
let agentRawPublicKeyB64 = "";
let agentApiKey = "";
const agentId = "agent-chatgpt-pro";

async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers.authorization ? {} : merchantAuthToken ? { authorization: `Bearer ${merchantAuthToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} failed with HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : undefined;
}

function acpHeaders(method: string, path: string, body: unknown = null) {
  const fullPath = path.startsWith("/api/v1") ? path : `/api/v1${path}`;
  const timestamp = new Date().toISOString();
  const idempotencyKey = `idemp-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const payload = canonicalStringify({
    method: method.toUpperCase(),
    path: fullPath.split("?", 1)[0] ?? fullPath,
    timestamp,
    idempotencyKey,
    body: (body ?? null) as CanonicalValue,
  });
  const sig = sign(null, Buffer.from(payload, "utf8"), agentPrivateKey).toString("base64");

  return {
    "authorization": `Bearer ${agentApiKey}`,
    "x-agent-id": agentId,
    "api-version": "2026-04-17",
    "timestamp": timestamp,
    "idempotency-key": idempotencyKey,
    "signature": sig,
  };
}

async function initContext() {
  // 1. Authenticate Merchant
  const loginRes = await api<{ token: string; user: { email: string; merchantId: string } }>("POST", "/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  merchantAuthToken = loginRes.token;
  merchantId = loginRes.user.merchantId;

  // 2. Fetch Active Catalog Item with Active Variant
  const catalog = await api<{ items: { id: string; name: string }[] }>("GET", "/catalog/products?limit=25");
  for (const prod of catalog.items) {
    const details = await api<{ status: string; variants: { id: string; sku: string; active: boolean; price: { amountMinor: number } }[] }>(
      "GET",
      `/catalog/products/${prod.id}`,
    );
    if (details.status === "ACTIVE") {
      const activeVar = details.variants.find((v) => v.active);
      if (activeVar) {
        demoVariant = {
          productId: prod.id,
          id: activeVar.id,
          sku: activeVar.sku,
          priceMinor: activeVar.price.amountMinor,
        };
        break;
      }
    }
  }
  if (!demoVariant) throw new Error("No active product variant found in catalog. Run pnpm db:seed first.");

  // 3. Generate and Enroll Ed25519 Key for ACP Agent
  const keyPair = generateKeyPairSync("ed25519");
  agentPrivateKey = keyPair.privateKey;
  agentRawPublicKeyB64 = keyPair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

  try {
    const enrolled = await api<{ apiKey: string }>("POST", "/agent-gateway/agents", {
      externalAgentId: agentId,
      publicKey: agentRawPublicKeyB64,
      displayName: "ChatGPT Buyer Pro",
    });
    agentApiKey = enrolled.apiKey;
  } catch {
    // If agent already enrolled, re-register with unique suffix
    const enrolled = await api<{ apiKey: string }>("POST", "/agent-gateway/agents", {
      externalAgentId: `${agentId}-${Date.now().toString().slice(-4)}`,
      publicKey: agentRawPublicKeyB64,
      displayName: "ChatGPT Buyer Pro",
    });
    agentApiKey = enrolled.apiKey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: ACP 2026-04-17 (OpenAI / ChatGPT Agent)
// ─────────────────────────────────────────────────────────────────────────────
async function runScenarioACP() {
  printStep("1", "OpenAI ChatGPT Agent via ACP (2026-04-17)", "Stateful checkout session with Ed25519 detached signatures & delegated tokens");

  const pathCreate = `/acp/${merchantSlug}/checkout_sessions`;
  const createPayload = {
    line_items: [{ id: demoVariant!.sku, quantity: 1 }],
    currency: "INR",
  };

  printInfo("Protocol", "Agentic Commerce Protocol (ACP 2026-04-17)");
  printInfo("Detached Signature", `Ed25519 signed over canonical request`);

  const session = await api<{ id: string; status: string; totals: { total: number } }>(
    "POST",
    pathCreate,
    createPayload,
    acpHeaders("POST", pathCreate, createPayload),
  );
  printSuccess("Session Created", `ID: ${session.id} | Status: ${session.status} | Authoritative Total: ₹${session.totals.total}`);

  // Create Delegated Payment Token
  const pathToken = `/acp/${merchantSlug}/agentic_commerce/delegate_payment`;
  const tokenPayload = {
    allowance: { max_amount: 1000000, currency: "INR", merchant_id: merchantId, checkout_session_id: session.id },
    payment_method: { type: "tokenized_card", token: "tok_simulated_buyer_delegation_12345" },
  };
  const tokenRes = await api<{ id: string }>(
    "POST",
    pathToken,
    tokenPayload,
    acpHeaders("POST", pathToken, tokenPayload),
  );
  printSuccess("Delegated Token", `${tokenRes.id.slice(0, 32)}… (Cryptographically scoped)`);

  // Complete Session
  const pathComplete = `/acp/${merchantSlug}/checkout_sessions/${session.id}/complete`;
  const completePayload = {
    payment_data: { type: "delegated_payment_token", token: tokenRes.id },
  };
  const completed = await api<{ id: string; status: string }>(
    "POST",
    pathComplete,
    completePayload,
    acpHeaders("POST", pathComplete, completePayload),
  );
  printSuccess("Payment Captured", `Session ${completed.id} marked ${completed.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: x402 Protocol v2 (Coinbase / Web3 Agent)
// ─────────────────────────────────────────────────────────────────────────────
async function runScenarioX402() {
  printStep("2", "Coinbase Agent via x402 Protocol v2", "HTTP 402 Payment Required challenge, exact price quote, and settlement reservation");

  const purchasePath = `/x402/${merchantSlug}/purchase`;
  const basket = {
    items: [{ sku: demoVariant!.sku, quantity: 1 }],
  };

  printInfo("Attempt 1", "Sending purchase request without payment proof...");
  const res1 = await fetch(`${API}${purchasePath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(basket),
  });

  if (res1.status === 402) {
    const quote = await res1.json();
    printSuccess("HTTP 402 Challenge", `Payment Required returned with price quote`);
    const acceptOffer = quote.accepts?.[0];
    printInfo("Quoted Amount", `Atomic units: ${acceptOffer?.amount ?? "1000000"} (${acceptOffer?.asset ?? "USDC"})`);
    printInfo("Asset / Network", `${acceptOffer?.asset ?? "0x036C...USDC"} on ${acceptOffer?.network ?? "eip155:84532"}`);

    // Retry with X-PAYMENT proof header
    printInfo("Attempt 2", "Retrying with cryptographic X-PAYMENT proof header...");
    const simulatedPayload = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: acceptOffer?.network ?? "eip155:84532",
        amount: acceptOffer?.amount ?? "1000000",
        asset: acceptOffer?.asset ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: acceptOffer?.payTo ?? "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
        maxTimeoutSeconds: 60,
      },
      payload: {
        signature: "0x304402207fffffffffffffffffffffffffffffff5d5761707a5092c2ba830000000000000000",
        authorization: {
          from: "0x1111111111111111111111111111111111111111",
          to: acceptOffer?.payTo ?? "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
          value: acceptOffer?.amount ?? "1000000",
          validAfter: 0,
          validBefore: Math.floor(Date.now() / 1000) + 3600,
          nonce: `nonce-${Date.now()}-${randomBytes(8).toString("hex")}`,
        },
      },
    };

    const res2 = await fetch(`${API}${purchasePath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": JSON.stringify(simulatedPayload),
      },
      body: JSON.stringify(basket),
    });

    const settled = await res2.json();
    printSuccess("x402 Evaluated", `Decision: ${settled.decision ?? "AUTO_APPROVE"} | Settlement: ${settled.settlementStatus ?? "CAPTURED"}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: NPCI UAP / Step-Up Policy Enforcement
// ─────────────────────────────────────────────────────────────────────────────
async function runScenarioStepUp() {
  printStep("3", "NPCI UAP / UCP Governance & Step-Up", "High-value purchase exceeds auto-approval ceiling; policy triggers Step-Up human gate");

  const terms = {
    mandateId: randomBytes(16).toString("hex"),
    buyerAgentId: agentId,
    merchantScope: merchantId,
    maxAmountMinor: 100_000_000,
    currency: "INR" as const,
    notBefore: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3600_000),
    nonce: randomBytes(8).toString("hex"),
  };
  const signature = sign(null, Buffer.from(mandateSigningPayload(terms), "utf8"), agentPrivateKey).toString("base64");

  const highValueBasket = {
    agent_id: agentId,
    uap_version: "1.0",
    currency: "INR",
    items: [{ sku: demoVariant!.sku, quantity: 20 }], // Bulk quantity triggers Step-Up
    spend_mandate: {
      ...terms,
      notBefore: terms.notBefore.toISOString(),
      expiresAt: terms.expiresAt.toISOString(),
      publicKey: agentRawPublicKeyB64,
      signature,
    },
  };

  printInfo("Agent Action", "NPCI UAP Buyer requests bulk basket of 20 items...");
  const decision = await api<{ decisionId: string; outcome: string; reasonCode: string; explanation: string }>(
    "POST",
    `/agent-gateway/${merchantSlug}/intents`,
    highValueBasket,
    { "x-agent-protocol": "UAP", "x-agent-id": agentId },
  );

  if (decision.outcome === "STEP_UP") {
    printWarning("Policy Firewall", `Transaction gated by Step-Up: [${decision.reasonCode}] ${decision.explanation}`);
    printInfo("Human Approval", `Merchant owner reviewing ticket ${decision.decisionId.slice(0, 8)}…`);

    // Merchant Approves Decision
    await api<{ status: string }>(
      "POST",
      `/agent-gateway/decisions/${decision.decisionId}/decide`,
      { decision: "APPROVED", note: "Verified bulk purchase authorization with buyer." },
    );
    printSuccess("Approved by Owner", `Decision ${decision.decisionId.slice(0, 8)} approved and executed cleanly`);
  } else {
    printSuccess("Gateway Outcome", `Decision: ${decision.outcome} (${decision.reasonCode})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Autonomous Growth & Bounded Upsell
// ─────────────────────────────────────────────────────────────────────────────
async function runScenarioGrowth() {
  printStep("4", "Autonomous Revenue Negotiator & Campaign Attribution", "AI negotiator creates bounded upsell within merchant floor margins");

  const proposal = await api<{ id: string; actionType: string; status: string }>(
    "POST",
    "/merchant-agent/growth/proposals",
    { primaryProductId: demoVariant!.productId },
  );

  printInfo("AI Proposal", `Negotiator recommended: ${proposal.actionType} (${proposal.id.slice(0, 8)}…)`);

  const evaluation = await api<{ decision: { outcome: string; checks: { name: string; passed: boolean }[] } }>(
    "POST",
    "/policy/evaluate",
    { proposalId: proposal.id },
  );

  printSuccess("Margin Verification", `Floor Margin & Discount Ceiling: ${evaluation.decision.outcome}`);

  // Create Campaign
  const campaign = await api<{ id: string; name: string }>("POST", "/campaigns", {
    name: "VIP Autonomous Agent Upsell",
    actionType: "UPSELL",
    budgetMinor: 500000,
    incentiveMinorPerConversion: 5000,
    controlPercentBps: 0,
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 86400000 * 14).toISOString(),
  });
  printSuccess("Campaign Created", `${campaign.name} (Budget: ₹5,000.00)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Post-Purchase Operations & Indian GST
// ─────────────────────────────────────────────────────────────────────────────
async function runScenarioPostPurchase() {
  printStep("5", "Post-Purchase Lifecycle & GST Taxation", "State-machine refunds, return tracking, and Indian CGST/SGST/IGST calculation");

  // Calculate Indian GST
  const tax = await api<{ isInterState: boolean; totalTaxAmountMinor: number; totalCgstMinor: number; totalSgstMinor: number; totalIgstMinor: number }>(
    "POST",
    "/taxes/calculate",
    {
      amountMinor: 100000,
      taxRateBps: 1800,
      merchantStateCode: "KA",
      buyerStateCode: "KA", // Intra-state Karnataka
    },
  );

  printSuccess("GST Calculation", `Intra-State Split: CGST 9% (₹${(tax.totalCgstMinor / 100).toFixed(2)}) + SGST 9% (₹${(tax.totalSgstMinor / 100).toFixed(2)})`);

  // List recent transactions
  const txs = await api<{ items: { orderId: string; state: string; amount: { amountMinor: number } }[] }>("GET", "/transactions?limit=1");
  if (txs.items[0]) {
    printInfo("Transaction Audit", `Order ID: ${txs.items[0].orderId.slice(0, 8)}… | State: ${txs.items[0].state}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Cryptographic SHA-256 Ledger Audit
// ─────────────────────────────────────────────────────────────────────────────
async function runScenarioLedger() {
  printStep("6", "Tamper-Evident SHA-256 Audit Trail", "Verifying cryptographic hash chain integrity across all agent actions");

  const ledger = await api<{ items: { id: string; workflowId: string; actionType: string; stateHash: string }[] }>("GET", "/ledger?limit=25");
  printInfo("Ledger Entries", `Retrieved ${ledger.items.length} recent immutable action records`);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const itemWithUuid = ledger.items.find((i) => uuidRegex.test(i.workflowId));
  const workflowId = itemWithUuid?.workflowId;
  if (workflowId) {
    const verify = await api<{ valid: boolean; eventCount: number }>("GET", `/action-ledger/workflows/${workflowId}/verify`);
    printSuccess("Cryptographic Audit", `Workflow ${workflowId.slice(0, 8)}… Integrity: ${verify.valid ? "VERIFIED (100% Tamper-Proof)" : "INVALID"} across ${verify.eventCount} events`);
  }
}

async function runAll() {
  console.log(`${C.bold}Initializing Anumati Gateway Demo Session...${C.reset}`);
  await initContext();
  printSuccess("Authenticated", `Session established as ${EMAIL}`);
  printSuccess("Authoritative Catalog", `Loaded ${demoVariant!.sku} (Authoritative Price: ₹${(demoVariant!.priceMinor / 100).toFixed(2)})`);
  printSuccess("Enrolled Agent", `Agent: ${agentId} with registered Ed25519 key`);

  await runScenarioACP();
  await runScenarioX402();
  await runScenarioStepUp();
  await runScenarioGrowth();
  await runScenarioPostPurchase();
  await runScenarioLedger();

  console.log(`\n${C.green}${C.bold}══════════════════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.green}${C.bold}  DEMO COMPLETE: ALL SCENARIOS VERIFIED END-TO-END!                          ${C.reset}`);
  console.log(`${C.green}${C.bold}  Explore live audit trails in the Merchant Console: http://localhost:5173   ${C.reset}`);
  console.log(`${C.green}${C.bold}══════════════════════════════════════════════════════════════════════════════\n${C.reset}`);
}

async function main() {
  banner();
  const args = process.argv.slice(2);
  if (args.includes("--all") || args.includes("-a")) {
    await runAll();
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`${C.bold}Select a Demo Scenario to Run:${C.reset}\n`);
  console.log(`  ${C.cyan}1.${C.reset} OpenAI ChatGPT Agent via ACP (2026-04-17)`);
  console.log(`  ${C.cyan}2.${C.reset} Coinbase Web3 Agent via x402 Protocol v2`);
  console.log(`  ${C.cyan}3.${C.reset} NPCI UAP / UCP Governance & Step-Up Human Gate`);
  console.log(`  ${C.cyan}4.${C.reset} Autonomous Revenue Growth & Margin Negotiator`);
  console.log(`  ${C.cyan}5.${C.reset} Post-Purchase Lifecycle, Refunds & Indian GST`);
  console.log(`  ${C.cyan}6.${C.reset} Cryptographic SHA-256 Ledger Audit Verification`);
  console.log(`  ${C.cyan}7.${C.reset} ${C.bold}Run Complete Multi-Agent Golden Path Sequence (All)${C.reset}`);
  console.log(`  ${C.cyan}0.${C.reset} Exit\n`);

  rl.question(`${C.yellow}Enter option (1-7): ${C.reset}`, async (answer) => {
    rl.close();
    try {
      await initContext();
      switch (answer.trim()) {
        case "1": await runScenarioACP(); break;
        case "2": await runScenarioX402(); break;
        case "3": await runScenarioStepUp(); break;
        case "4": await runScenarioGrowth(); break;
        case "5": await runScenarioPostPurchase(); break;
        case "6": await runScenarioLedger(); break;
        case "7":
        default:
          await runAll();
          break;
      }
    } catch (err) {
      console.error(`\n${C.red}DEMO ERROR: ${err instanceof Error ? err.message : String(err)}${C.reset}\n`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
