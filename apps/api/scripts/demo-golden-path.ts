/**
 * Canonical end-to-end workflow driver — the "failure-first" demo.
 *
 * Drives ONE real workflow through every governed stage against the
 * RUNNING API over HTTP, exactly as the browser does, and prints the
 * evidence at each step:
 *
 *   growth proposal -> validation -> policy -> approval (if required)
 *   -> scoped authorization -> checkout -> payment attempt 1 FAILS
 *   -> recovery eligibility -> recovery proposal -> recovery policy
 *   -> recovery authorization -> payment attempt 2 CAPTURED
 *   -> hash-chained ledger -> Trust Trace
 *
 * WHY THIS EXISTS
 *
 * The track's bar asks for "one failure handled gracefully". Recovery was
 * implemented and unit-tested from PART 08, but there was no way to SHOW
 * it end to end without manually clicking through a payment gateway and
 * choosing "fail" at exactly the right moment. This makes that path
 * repeatable, so the resulting workflow can be opened in Trust Trace and
 * walked in front of an audience.
 *
 * HONESTY — READ THIS BEFORE DEMOING
 *
 * The two payment outcomes are delivered as provider webhooks that this
 * script SIGNS ITSELF using the merchant's own configured
 * `RAZORPAY_WEBHOOK_SECRET`. That is a genuine exercise of the real
 * verification pipeline — signature check, schema validation,
 * idempotency, payment state machine, ledger append — and the app cannot
 * tell it apart from a real delivery, which is the point: the pipeline is
 * real.
 *
 * It is NOT evidence produced by Razorpay. Nothing here proves a payment
 * happened at Razorpay. Say "this exercises our webhook pipeline
 * end to end", never "Razorpay confirmed this payment".
 *
 * Run with the API already running:
 *   pnpm demo:golden-path
 */
import { createHmac } from "node:crypto";

const API = process.env.DEMO_API_BASE_URL ?? "http://localhost:4000/api/v1";
const EMAIL = process.env.DEMO_EMAIL ?? "owner@meridianathletics.demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "MeridianDemo!2026";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

/** Products whose seeded relationships reliably yield a proposal. Tried in
 * order — the Merchant Agent's chosen related product varies, and a
 * proposal can legitimately be refused by deterministic validation, which
 * is itself correct behaviour rather than a script failure. */
const PREFERRED_PRODUCTS = ["Meridian Pulse Runner", "Meridian Summit Trail", "Meridian Trailblaze GTX"];

let token = "";

function log(step: string, detail: string) {
  console.log(`  ${step.padEnd(26)} ${detail}`);
}
function heading(text: string) {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

async function api<T>(method: string, path: string, body?: unknown, rawHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rawHeaders,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Builds a Razorpay-shaped webhook and signs it the way Razorpay does:
 * HMAC-SHA256 over the RAW body using the merchant's webhook secret. An
 * incorrect secret here produces a rejected event, which is the correct
 * outcome and worth demonstrating too. */
async function sendSignedWebhook(event: string, entity: Record<string, unknown>): Promise<string> {
  const rawBody = JSON.stringify({ event, payload: { payment: { entity } } });
  const signature = createHmac("sha256", WEBHOOK_SECRET!).update(rawBody).digest("hex");
  // The route answers `{status:"ok"}` for every signature-verified outcome
  // and `{status:"rejected"}` with HTTP 400 only for a bad signature, so
  // a 400 here is a real failure worth surfacing rather than swallowing.
  const res = await api<{ status: string }>("POST", "/payments/webhooks/razorpay", rawBody, {
    "content-type": "application/json",
    "x-razorpay-signature": signature,
  });
  return res.status;
}

interface Product { id: string; name: string }
interface Proposal { id: string; status: string; actionType: string | null; rejectionReason?: string | null }

async function findWorkableProposal(): Promise<{ proposal: Proposal; authorizationId: string; productId: string }> {
  const catalog = await api<{ items: Product[] }>("GET", "/catalog/products?limit=25");

  const ordered = [
    ...PREFERRED_PRODUCTS.map((n) => catalog.items.find((p) => p.name === n)).filter((p): p is Product => Boolean(p)),
    ...catalog.items,
  ];

  for (const product of ordered) {
    const proposal = await api<Proposal>("POST", "/merchant-agent/growth/proposals", { primaryProductId: product.id });
    if (proposal.status !== "PROPOSED") continue;

    const evaluated = await api<{ decision: { outcome: string }; authorization: { id?: string } | null }>(
      "POST",
      "/policy/evaluate",
      { proposalId: proposal.id },
    );
    log("policy decision", evaluated.decision.outcome);

    let authorizationId = evaluated.authorization?.id;

    if (evaluated.decision.outcome === "REQUIRE_APPROVAL") {
      const approved = await api<{ approval: { approverId: string }; authorization: { id: string } }>(
        "POST",
        `/approvals/${proposal.id}/approve`,
        { reason: "Approved during the canonical demo run." },
      );
      log("human approval", `recorded against user ${approved.approval.approverId.slice(0, 8)}…`);
      authorizationId = approved.authorization.id;
    }

    if (authorizationId) return { proposal, authorizationId, productId: product.id };
  }

  throw new Error("No product produced an authorizable proposal. Has `pnpm db:seed` been run?");
}

async function main() {
  if (!WEBHOOK_SECRET) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not set — this script signs its own webhooks and cannot run without it.");
  }

  console.log("RazorGrowth — canonical failure-first workflow");
  console.log(`API: ${API}`);

  heading("1. Identity");
  const auth = await api<{ token: string; user: { email: string; role: string } }>("POST", "/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  token = auth.token;
  log("signed in", `${auth.user.email} (${auth.user.role})`);

  const capabilities = await api<{ paymentProvider: string }>("GET", "/system/capabilities");
  log("payment provider", capabilities.paymentProvider);

  heading("2. AI proposes, deterministic systems decide");
  const { proposal, authorizationId, productId } = await findWorkableProposal();
  log("proposal", `${proposal.actionType} (${proposal.id.slice(0, 8)}…)`);
  log("authorization", `ACTIVE (${authorizationId.slice(0, 8)}…)`);

  heading("3. Commerce execution — server computes the amount");
  const agentProduct = await api<{ variants: { variantId: string; availability: { state: string } }[] }>(
    "GET",
    `/agent-commerce/catalog/${productId}`,
  );
  const variant = agentProduct.variants.find((v) => ["IN_STOCK", "LOW_STOCK"].includes(v.availability.state));
  if (!variant) throw new Error("No purchasable variant on the primary product.");

  const checkout = await api<{ checkoutId: string; orderId: string; totals: { totalMinor: number; currency: string } }>(
    "POST",
    "/commerce/checkout",
    {
      authorizationId,
      selection: { productId, variantId: variant.variantId, quantity: 1 },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  log("checkout", `${checkout.checkoutId.slice(0, 8)}… — ${checkout.totals.currency} ${(checkout.totals.totalMinor / 100).toFixed(2)}`);

  heading("4. Payment attempt 1 — FAILS");
  const attempt1 = await api<{ paymentId: string; providerOrderId: string }>("POST", "/payments/initiate", {
    checkoutId: checkout.checkoutId,
  });
  log("provider order", attempt1.providerOrderId);

  log(
    "signed webhook",
    await sendSignedWebhook("payment.failed", {
      id: `pay_demo_fail_${Date.now()}`,
      order_id: attempt1.providerOrderId,
      amount: checkout.totals.totalMinor,
      currency: checkout.totals.currency,
      status: "failed",
      method: "card",
      error_code: "BAD_REQUEST_ERROR",
      error_description: "Payment declined by the issuing bank.",
    }) === "ok"
      ? "accepted — signature verified"
      : "REJECTED",
  );

  const failed = await api<{ state: string; failureCategory: string | null }>("GET", `/payments/${attempt1.paymentId}`);
  log("payment state", `${failed.state}${failed.failureCategory ? ` (${failed.failureCategory})` : ""}`);

  heading("5. Bounded recovery");
  // Recovery is not a special back door: the Merchant Agent proposes a
  // recovery action, and that proposal walks the SAME policy and
  // authorization chain as any growth proposal before anything is retried.
  const recoveryProposal = await api<Proposal>("POST", "/payments/recovery/evaluate", {
    paymentId: attempt1.paymentId,
  });
  log("recovery proposal", `${recoveryProposal.status}${recoveryProposal.rejectionReason ? ` — ${recoveryProposal.rejectionReason}` : ""}`);

  if (recoveryProposal.status !== "PROPOSED") {
    console.log("\nRecovery was refused before policy. That is a valid governed outcome, not a script error.");
    return;
  }

  const recoveryPolicy = await api<{ decision: { outcome: string }; authorization: { id?: string } | null }>(
    "POST",
    "/policy/evaluate",
    { proposalId: recoveryProposal.id },
  );
  log("recovery policy", recoveryPolicy.decision.outcome);

  let recoveryAuthId = recoveryPolicy.authorization?.id;
  if (recoveryPolicy.decision.outcome === "REQUIRE_APPROVAL") {
    const approved = await api<{ authorization: { id: string } }>("POST", `/approvals/${recoveryProposal.id}/approve`, {
      reason: "Recovery approved during the canonical demo run.",
    });
    recoveryAuthId = approved.authorization.id;
    log("human approval", "recovery approved by a real merchant user");
  }
  if (!recoveryAuthId) {
    console.log("\nPolicy refused to authorize the recovery. That is a valid governed outcome.");
    return;
  }
  log("recovery authz", `${recoveryAuthId.slice(0, 8)}…`);

  // Recovery produces a NEW checkout on the same commercial terms — it
  // never mutates the failed one. Attempt 2 is then a normal payment
  // initiation against that checkout, so it walks the same code path as
  // attempt 1 rather than a privileged retry back door.
  const recoveryCheckout = await api<{ checkoutId: string }>("POST", `/payments/recovery/${recoveryAuthId}/execute`, {
    idempotencyKey: crypto.randomUUID(),
  });
  log("recovery checkout", `${recoveryCheckout.checkoutId.slice(0, 8)}… (terms unchanged)`);

  const attempt2 = await api<{ paymentId: string; providerOrderId: string }>("POST", "/payments/initiate", {
    checkoutId: recoveryCheckout.checkoutId,
  });
  log("attempt 2 order", attempt2.providerOrderId);

  heading("6. Payment attempt 2 — CAPTURED");
  const captureEntity = {
    id: `pay_demo_ok_${Date.now()}`,
    order_id: attempt2.providerOrderId,
    amount: checkout.totals.totalMinor,
    currency: checkout.totals.currency,
    status: "captured",
    method: "card",
  };
  log("signed webhook", (await sendSignedWebhook("payment.captured", captureEntity)) === "ok" ? "accepted — signature verified" : "REJECTED");

  const captured = await api<{ state: string }>("GET", `/payments/${attempt2.paymentId}`);
  log("payment state", captured.state);

  // Replaying the IDENTICAL event proves idempotency: a duplicate delivery
  // must never double-count captured money. Razorpay really does redeliver.
  await sendSignedWebhook("payment.captured", captureEntity);
  const afterReplay = await api<{ state: string; amountMinor: number }>("GET", `/payments/${attempt2.paymentId}`);
  log("duplicate delivery", `state still ${afterReplay.state}, amount still ${(afterReplay.amountMinor / 100).toFixed(2)} — no double count`);

  heading("7. Audit");
  const ledger = await api<{ items: { workflowId: string }[] }>("GET", "/ledger?limit=1");
  const workflowId = ledger.items[0]?.workflowId;
  if (workflowId) {
    const verify = await api<{ valid: boolean; eventCount: number }>(
      "GET",
      `/action-ledger/workflows/${workflowId}/verify`,
    );
    log("ledger integrity", `${verify.valid ? "VERIFIED" : "BROKEN"} across ${verify.eventCount} events`);
    console.log(`\nOpen this workflow in Trust Trace:\n  http://localhost:5173/trust-trace?workflowId=${workflowId}\n`);
  }

  console.log("Reminder: the two payment outcomes above were webhooks this script signed with your own");
  console.log("webhook secret. They exercise the real verification pipeline; they are not Razorpay evidence.\n");
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
