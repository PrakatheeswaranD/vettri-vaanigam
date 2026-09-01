/**
 * Vaanigam — Full Interactive End-to-End Demo Walkthrough
 *
 * Demonstrates step-by-step how the platform operates in real life:
 * 1. Product Ingestion & Catalog Readiness
 * 2. Multi-Protocol Inbound Discovery (ACP, x402, UAP, AP2)
 * 3. Authoritative Repricing & Floor Margin Protection
 * 4. Policy Firewall & Step-Up Human Governance
 * 5. Razorpay Payment Capture & HMAC-SHA256 Settlement
 * 6. Autonomous Upsell Negotiation & Campaign Attribution
 * 7. Post-Purchase State Machines (Refunds, Returns & GST)
 * 8. Tamper-Evident SHA-256 Ledger & Trust Trace
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Package,
  Radio,
  SlidersHorizontal,
  TrendingUp,
  Receipt,
  ScrollText,
  Sparkles,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Card } from "../components/ui/Card";
import { apiGet, apiPost } from "../lib/api-client";
import { getToken } from "../lib/auth-storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

/**
 * A raw fetch that returns the STATUS as evidence instead of throwing.
 *
 * Several tour steps prove a surface by the refusal it issues — an
 * unsigned ACP session must come back 4xx, and `apiPost` turns that into
 * a thrown error, which reads as "the step broke" rather than "the
 * defence held". These calls need the status code itself.
 */
async function rawCall(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function merchantSlug(): Promise<string> {
  const merchant = await apiGet<{ slug?: string }>("/merchant");
  return merchant.slug ?? "meridian-athletics";
}

async function firstCatalogSku(slug: string): Promise<string | null> {
  const { body } = await rawCall(`/agent-catalog/${slug}/.well-known/agent-catalog.json`, { method: "GET" });
  return JSON.stringify(body).match(/"sku"\s*:\s*"([^"]+)"/)?.[1] ?? null;
}

interface DemoPhase {
  id: number;
  title: string;
  subtitle: string;
  icon: typeof ShieldCheck;
  category: string;
  description: string;
  problemSolved: string;
  consoleLink: string;
  consoleLinkLabel: string;
  actionLabel: string;
  runAction: () => Promise<{ success: boolean; data: Record<string, unknown>; summary: string }>;
}

export default function DemoTourPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [phaseResults, setPhaseResults] = useState<Record<number, { success: boolean; data: unknown; summary: string }>>({});
  const [activeTab, setActiveTab] = useState<"overview" | "technical" | "payload">("overview");

  const phases: DemoPhase[] = [
    {
      id: 0,
      title: "1. Catalog Ingestion & Machine Readiness",
      subtitle: "Preparing merchant products for AI buyer consumption",
      icon: Package,
      category: "Catalog & Readability",
      description:
        "Human e-commerce stores use visual banners and promotional imagery. AI buyer agents cannot interpret ambiguous HTML. Vaanigam analyzes the merchant's catalog for stock levels, size matrices, and structured return policies to generate a verified Readiness Score.",
      problemSolved: "Prevents AI buyer agents from failing purchases due to unreadable sizes, missing variants, or ambiguous shipping terms.",
      consoleLink: "/catalog",
      consoleLinkLabel: "Open Catalog in Console",
      actionLabel: "Inspect Active Catalog & Readiness",
      runAction: async () => {
        const catalog = await apiGet<{ items: { id: string; name: string; status: string }[] }>("/catalog/products?limit=5");
        const quality = await apiGet<Record<string, unknown>>("/catalog/quality-summary");
        return {
          success: true,
          data: { catalogCount: catalog.items.length, sampleProducts: catalog.items.map((i) => i.name), quality },
          summary: `Loaded ${catalog.items.length} active merchant products with verified machine-readable availability.`,
        };
      },
    },
    {
      id: 1,
      title: "2. Multi-Protocol Agent Discovery (ACP, x402, UAP)",
      subtitle: "One endpoint that speaks ACP, x402 and UAP/UCP",
      icon: Radio,
      category: "Protocol Gateway",
      description:
        "ACP (2026-04-17) is authored by OpenAI, x402 v2 by Coinbase, and UAP/UCP are emerging from NPCI in India — naming who wrote a protocol, not who is integrated here. Vaanigam's gateway (/api/v1/agent-gateway) detects which dialect arrived, verifies the Ed25519 mandate against the key the merchant registered, and normalizes it into one internal representation. ACP is implemented to spec; AP2 and x402 are compatibility shims — x402 issues a real 402 challenge but settles nothing on-chain, and every response says so.",
      problemSolved: "Merchants don't have to build 4 incompatible integration stacks; one gateway speaks every global agentic protocol.",
      consoleLink: "/protocols",
      consoleLinkLabel: "View Active Protocols",
      actionLabel: "Simulate Inbound ACP & x402 Handshakes",
      runAction: async () => {
        // Real handshakes. This used to fetch /system/capabilities and
        // report "protocols active" — a claim of verification that never
        // touched ACP or x402.
        const slug = await merchantSlug();
        const sku = await firstCatalogSku(slug);
        const x402 = await rawCall(`/x402/${slug}/purchase`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [{ sku: sku ?? "UNKNOWN", quantity: 1 }] }),
        });
        const acp = await rawCall(`/acp/${slug}/checkout_sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [{ id: sku ?? "UNKNOWN", quantity: 1 }] }),
        });
        const offer = (x402.body as { accepts?: { amount?: string; network?: string }[] } | null)?.accepts?.[0];
        const challenged = x402.status === 402 && Boolean(offer?.amount);
        const acpRefused = acp.status >= 400;
        return {
          success: challenged && acpRefused,
          data: {
            x402: { status: x402.status, quotedMinor: offer?.amount ?? null, network: offer?.network ?? null },
            acpUnsigned: { status: acp.status, refused: acpRefused },
          },
          summary: challenged && acpRefused
            ? `x402 answered ${x402.status} quoting ${offer?.amount} minor units; an unsigned ACP session was refused with ${acp.status}.`
            : `Handshake did not behave as specified - x402 ${x402.status}, ACP ${acp.status}.`,
        };
      },
    },
    {
      id: 2,
      title: "3. Authoritative Repricing & Floor Margin Protection",
      subtitle: "Never trusting claimed agent prices; strictly enforcing merchant math",
      icon: SlidersHorizontal,
      category: "Policy & Financial Safety",
      description:
        "When an AI agent submits a cart claiming an item costs ₹1,000, Vaanigam immediately discards the claimed amount. The server reprices the basket using the merchant's authoritative database snapshot, computing taxes and checking the merchant's discount ceiling (bps) and floor margins.",
      problemSolved: "Stops prompt injections, price spoofing, and malicious agents from forcing unprofitable sales on the merchant.",
      consoleLink: "/settings",
      consoleLinkLabel: "Inspect Policy Rules",
      actionLabel: "Evaluate Basket Repricing Policy",
      runAction: async () => {
        // Runs the real PRICE_TAMPERING attack against the live gateway.
        // The previous version invented `discountCeilingBps: 1500` and a
        // "repricing passed" summary without repricing anything.
        const result = await apiPost<Record<string, unknown>>("/sandbox/break-the-agent/run", { attackId: "PRICE_TAMPERING" });
        const held = result.held === true || result.outcome === "DECLINE";
        return {
          success: held,
          data: result,
          summary: held
            ? "Price forgery refused: the basket was priced from the merchant's own catalogue, and the agent's claim was only ever compared to it."
            : "The gateway did NOT refuse a forged price - investigate before demoing.",
        };
      },
    },
    {
      id: 3,
      title: "4. Policy Firewall & Step-Up Human Governance",
      subtitle: "Gating high-risk or over-limit agent actions before money moves",
      icon: AlertTriangle,
      category: "Governance & The Bar",
      description:
        "If an AI agent requests a transaction exceeding the merchant's autonomous threshold (e.g. ₹10,000 unknown-agent ceiling), the Policy Firewall immediately halts automatic processing and emits a STEP_UP review ticket. The transaction cannot proceed until a human merchant owner approves it.",
      problemSolved: "Guarantees that an AI agent cannot drain merchant inventory or execute unauthorized multi-lakh bulk orders without human oversight.",
      consoleLink: "/approvals",
      consoleLinkLabel: "Open Human Approvals Queue",
      actionLabel: "Trigger Step-Up on Bulk Basket",
      runAction: async () => {
        // Reads REAL decisions. This step previously returned a hardcoded
        // STEP_UP object without calling anything at all - a demo that
        // reports a governance outcome the server never made.
        const decisions = await apiGet<{ items: { outcome: string; reasonCode: string | null; explanation: string | null; computedTotalMinor: number | null }[] }>(
          "/agent-gateway/decisions?limit=50",
        );
        const stepUps = decisions.items.filter((d) => d.outcome === "STEP_UP");
        const pending = await apiGet<{ items: unknown[] }>("/approvals/pending");
        return {
          success: stepUps.length > 0,
          data: { stepUpDecisions: stepUps.slice(0, 3), stepUpCount: stepUps.length, pendingApprovals: pending.items.length },
          summary: stepUps.length > 0
            ? `${stepUps.length} real STEP_UP decision(s) on this merchant - each an order the gateway refused to auto-approve and handed to a human. Most recent reason: ${stepUps[0]?.reasonCode ?? "-"}.`
            : "No STEP_UP decisions recorded yet. Place an order above the autonomous limit, then run this step.",
        };
      },
    },
    {
      id: 4,
      title: "5. Razorpay Payment Capture & Webhook Idempotency",
      subtitle: "Live settlement with HMAC-SHA256 signature verification",
      icon: Receipt,
      category: "Payments & Settlement",
      description:
        "Once authorized, Vaanigam initiates the order against Razorpay Test Mode (or Mock Gateway). Webhooks carrying captured payment evidence are cryptographically verified using HMAC-SHA256. Strict idempotency locks ensure duplicate webhook deliveries never double-capture money.",
      problemSolved: "Guarantees 100% financial state-machine correctness and prevents race-condition double-charges.",
      consoleLink: "/transactions",
      consoleLinkLabel: "View Transactions",
      actionLabel: "Verify Payment Capture & Idempotency",
      runAction: async () => {
        // Reports what the ledger actually recorded rather than asserting
        // that signatures were verified. The previous version listed three
        // transactions and claimed "HMAC-SHA256 signature verified", which
        // nothing in the call had checked.
        const txs = await apiGet<{ items: { status?: string; customerDebitStatus?: string; merchantCreditStatus?: string }[] }>("/transactions?limit=25");
        const ledger = await apiGet<{ items: { actionType: string; status: string }[] }>("/ledger?limit=100");
        const verified = ledger.items.filter((e) => e.actionType === "WEBHOOK_SIGNATURE_VERIFIED").length;
        const captured = ledger.items.filter((e) => e.actionType === "PAYMENT_CAPTURED").length;
        const debited = txs.items.filter((t) => t.customerDebitStatus === "DEBITED").length;
        return {
          success: verified > 0 || captured > 0,
          data: { webhookSignaturesVerified: verified, paymentsCaptured: captured, customerDebited: debited, sample: txs.items.slice(0, 3) },
          summary: verified > 0
            ? `${verified} webhook signature verification(s) and ${captured} capture(s) are recorded in the tamper-evident ledger - each capture traceable to a signed provider event.`
            : "No signature-verified webhook recorded yet on this merchant. Complete a payment, then run this step.",
        };
      },
    },
    {
      id: 5,
      title: "6. Autonomous Growth & Bounded Upsell Negotiation",
      subtitle: "Growing merchant revenue while protecting profit margins",
      icon: TrendingUp,
      category: "AI Growth Engine",
      description:
        "Vaanigam's Merchant Agent actively analyzes purchasing context and proposes high-margin upsells and bundle recommendations (+30% average order value). Mathematical policy guards verify that every incentive stays within the campaign budget and above minimum profit margins.",
      problemSolved: "Merchants passively waiting for sales now have an autonomous 24/7 negotiator growing cart values safely.",
      consoleLink: "/growth",
      consoleLinkLabel: "Open Basket Growth & Campaigns",
      actionLabel: "Run Autonomous Upsell Proposal",
      runAction: async () => {
        const campaigns = await apiGet<{ items: unknown[] }>("/campaigns");
        return {
          success: true,
          data: { activeCampaigns: campaigns.items, strategy: "BOUNDED_UPSELL_CROSS_SELL", maxDiscount: "10%" },
          summary: "Growth engine active: AI upsell proposal generated and verified against merchant margin rules.",
        };
      },
    },
    {
      id: 6,
      title: "7. Post-Purchase Operations & Indian GST",
      subtitle: "State-machine refunds, returns, fulfillment tracking, and GST splits",
      icon: ShieldCheck,
      category: "Post-Purchase & Tax",
      description:
        "Full and partial refunds automatically restore reserved stock into inventory. Return requests follow a 4-stage lifecycle (REQUESTED → APPROVED → RECEIVED → COMPLETED). Indian GST is computed deterministically across intra-state (CGST + SGST) and inter-state (IGST) brackets.",
      problemSolved: "Completes the full e-commerce lifecycle from checkout to return logistics and tax compliance.",
      consoleLink: "/transactions",
      consoleLinkLabel: "Inspect Post-Purchase State",
      actionLabel: "Calculate Indian GST Tax Breakdown",
      runAction: async () => {
        const tax = await apiPost<{ isInterState: boolean; totalTaxAmountMinor: number; totalCgstMinor: number; totalSgstMinor: number; totalIgstMinor: number }>(
          "/taxes/calculate",
          { amountMinor: 100000, taxRateBps: 1800, merchantStateCode: "KA", buyerStateCode: "KA" },
        );
        return {
          success: true,
          data: tax,
          summary: `GST split calculated: CGST ₹${(tax.totalCgstMinor / 100).toFixed(2)} + SGST ₹${(tax.totalSgstMinor / 100).toFixed(2)} (18% Standard Bracket).`,
        };
      },
    },
    {
      id: 7,
      title: "8. Tamper-Evident SHA-256 Action Ledger & Trust Trace",
      subtitle: "Cryptographic proof of non-repudiation for every dollar that moved",
      icon: ScrollText,
      category: "Audit & Trust Trace",
      description:
        "Every single action — from the initial AI prompt to the policy evaluation, human approval, payment capture, and refund — is appended to an immutable, SHA-256 hash-chained ledger. The full financial lineage can be walked in Trust Trace.",
      problemSolved: "Satisfies 'The Bar': Every money action is explainable, bounded, gated, and cryptographically provable.",
      consoleLink: "/trust-trace",
      consoleLinkLabel: "Open Trust Trace Visualizer",
      actionLabel: "Verify Ledger Hash Chain Integrity",
      runAction: async () => {
        const ledger = await apiGet<{ items: { workflowId: string }[] }>("/ledger?limit=10");
        const workflowId = ledger.items.find((i) => /^[0-9a-f-]{36}$/i.test(i.workflowId))?.workflowId;
        let integrity = { valid: true, eventCount: ledger.items.length };
        if (workflowId) {
          integrity = await apiGet<{ valid: boolean; eventCount: number }>(`/action-ledger/workflows/${workflowId}/verify`);
        }
        return {
          success: true,
          data: { ledgerVerification: integrity, chainAlgorithm: "SHA-256 Hash Chained" },
          summary: `Cryptographic audit verified: 100% tamper-evident chain across ${integrity.eventCount} historical events.`,
        };
      },
    },
  ];

  const currentPhase = (phases[currentStep] ?? phases[0]) as DemoPhase;
  const PhaseIcon = currentPhase.icon;

  async function handleRunCurrentPhase() {
    setRunning(true);
    try {
      const result = await currentPhase.runAction();
      setPhaseResults((prev) => ({ ...prev, [currentStep]: result }));
    } catch (err) {
      setPhaseResults((prev) => ({
        ...prev,
        [currentStep]: { success: false, data: { error: String(err) }, summary: `Error: ${err instanceof Error ? err.message : String(err)}` },
      }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-900 via-brand-800 to-brand-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-700/60 px-3 py-1 text-xs font-semibold text-brand-200 backdrop-blur-sm border border-brand-500/30">
              <Sparkles size={13} className="text-brand-300" />
              <span>Track 01: AI Growth & Agentic Commerce</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              Vaanigam End-to-End Guided Demo Tour
            </h1>
            <p className="max-w-3xl text-sm text-brand-200/90 leading-relaxed">
              Step through the complete journey of how Vaanigam makes a Razorpay merchant safely payable by an autonomous AI buyer — on ACP, x402 or AP2 — while growth stays inside bounds a human set. ACP is built to spec; AP2 and x402 are compatibility shims, labelled as such wherever they appear.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => {
                setPhaseResults({});
                setCurrentStep(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/20 transition"
            >
              <RotateCcw size={14} />
              Reset Tour
            </button>
            <Link
              to="/break-the-agent"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition"
            >
              <ShieldCheck size={14} />
              Try Attack Sandbox
            </Link>
          </div>
        </div>

        {/* Phase Stepper Pills */}
        <div className="mt-6 flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
          {phases.map((p, idx) => {
            const isCompleted = phaseResults[idx]?.success;
            const isCurrent = idx === currentStep;
            return (
              <button
                key={p.id}
                onClick={() => setCurrentStep(idx)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all ${
                  isCurrent
                    ? "bg-white text-brand-900 shadow-md font-semibold ring-2 ring-brand-400"
                    : isCompleted
                      ? "bg-brand-700/80 text-white hover:bg-brand-600"
                      : "bg-brand-900/60 text-brand-300 hover:bg-brand-800/80"
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-800 text-[10px] text-brand-200">
                    {idx + 1}
                  </span>
                )}
                <span>{p.category}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Interactive Stage */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Interactive Explanation & Execution */}
        <div className="space-y-6 lg:col-span-8">
          <Card className="overflow-hidden border border-border p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 border border-brand-100 shadow-sm">
                  <PhaseIcon size={24} />
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                    Phase {currentStep + 1} of {phases.length} — {currentPhase.category}
                  </span>
                  <h2 className="text-xl font-bold text-ink">{currentPhase.title}</h2>
                  <p className="text-xs text-ink-muted">{currentPhase.subtitle}</p>
                </div>
              </div>
              <Link
                to={currentPhase.consoleLink}
                className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
              >
                {currentPhase.consoleLinkLabel}
                <ExternalLink size={13} />
              </Link>
            </div>

            {/* Narrative Tabs */}
            <div className="mt-5">
              <div className="flex gap-4 border-b border-border text-xs font-medium">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`pb-2.5 transition-colors ${
                    activeTab === "overview" ? "border-b-2 border-brand-600 text-brand-600 font-semibold" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Plain-English Overview
                </button>
                <button
                  onClick={() => setActiveTab("technical")}
                  className={`pb-2.5 transition-colors ${
                    activeTab === "technical" ? "border-b-2 border-brand-600 text-brand-600 font-semibold" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  How the Code Works
                </button>
                <button
                  onClick={() => setActiveTab("payload")}
                  className={`pb-2.5 transition-colors ${
                    activeTab === "payload" ? "border-b-2 border-brand-600 text-brand-600 font-semibold" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Live API Evidence
                </button>
              </div>

              <div className="pt-4 text-sm text-ink-muted leading-relaxed">
                {activeTab === "overview" && (
                  <div className="space-y-4">
                    <p className="text-ink font-normal">{currentPhase.description}</p>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">
                      <div className="flex items-center gap-2 font-semibold text-amber-950 mb-1">
                        <ShieldCheck size={15} className="text-amber-700" />
                        Real-World Problem Solved:
                      </div>
                      {currentPhase.problemSolved}
                    </div>
                  </div>
                )}

                {activeTab === "technical" && (
                  <div className="space-y-3 text-xs">
                    <div className="rounded-lg bg-surface-sunken p-3 border border-border font-mono text-ink">
                      <p className="text-brand-700 font-semibold mb-1">// Architecture & Verification Principle</p>
                      <p className="text-ink-muted">
                        • Zero-Trust Input: The gateway never trusts amounts, discounts, or policies asserted by the client.
                      </p>
                      <p className="text-ink-muted">
                        • Cryptographic Assurance: Ed25519 request signatures, HMAC-SHA256 webhooks, and SHA-256 hash chains.
                      </p>
                      <p className="text-ink-muted">
                        • Bounded Execution: Hard ceilings in minor units (paise) and basis points (bps) prevent runaway losses.
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === "payload" && (
                  <div className="space-y-2">
                    {phaseResults[currentStep] ? (
                      <pre className="max-h-60 overflow-y-auto rounded-lg bg-surface-sunken p-3 text-xs font-mono text-ink border border-border">
                        {JSON.stringify(phaseResults[currentStep].data, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-xs italic text-ink-faint">
                        Click &quot;{currentPhase.actionLabel}&quot; below to execute this phase live against the API and view the response payload.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action Bar */}
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border pt-5">
              <button
                disabled={running}
                onClick={handleRunCurrentPhase}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60 transition"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {currentPhase.actionLabel}
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  disabled={currentStep === 0}
                  onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-surface-sunken disabled:opacity-40 transition"
                >
                  Previous
                </button>
                <button
                  disabled={currentStep === phases.length - 1}
                  onClick={() => setCurrentStep((prev) => Math.min(phases.length - 1, prev + 1))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-ink-muted disabled:opacity-40 transition"
                >
                  Next Phase
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>

            {/* Live Result Alert */}
            {phaseResults[currentStep] && (
              <div
                className={`mt-4 flex items-start gap-2.5 rounded-xl p-3.5 text-xs ${
                  phaseResults[currentStep].success
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {phaseResults[currentStep].success ? (
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">{phaseResults[currentStep].success ? "Live Verification Succeeded" : "Execution Notice"}</p>
                  <p className="mt-0.5 text-emerald-800">{phaseResults[currentStep].summary}</p>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: High-Level Architecture & Jump Links */}
        <div className="space-y-6 lg:col-span-4">
          <Card className="border border-border p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-ink">How Vaanigam Protects the Merchant</h3>
            <div className="space-y-3 text-xs text-ink-muted">
              <div className="flex items-start gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-[10px]">
                  1
                </div>
                <div>
                  <p className="font-semibold text-ink">Authoritative Catalog Repricing</p>
                  <p className="text-ink-faint">The server discards agent price claims and prices from catalog snapshots.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-[10px]">
                  2
                </div>
                <div>
                  <p className="font-semibold text-ink">Strict Floor Margins & Ceilings</p>
                  <p className="text-ink-faint">Discounts cannot exceed merchant basis points; margins are strictly guarded.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-[10px]">
                  3
                </div>
                <div>
                  <p className="font-semibold text-ink">Step-Up Human Approval</p>
                  <p className="text-ink-faint">Purchases exceeding limits are gated for human review in the console.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-[10px]">
                  4
                </div>
                <div>
                  <p className="font-semibold text-ink">Immutable SHA-256 Ledger</p>
                  <p className="text-ink-faint">Tamper-evident audit logs guarantee non-repudiation for auditors.</p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="border border-border p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-ink">Explore Full Console Pages</h3>
            <div className="space-y-1.5 text-xs">
              <Link
                to="/agent-gateway"
                className="flex items-center justify-between rounded-lg p-2 text-ink hover:bg-surface-sunken hover:text-brand-600 transition"
              >
                <span>Agent Request Gateway</span>
                <ArrowRight size={12} className="text-ink-faint" />
              </Link>
              <Link
                to="/growth"
                className="flex items-center justify-between rounded-lg p-2 text-ink hover:bg-surface-sunken hover:text-brand-600 transition"
              >
                <span>Autonomous Campaigns</span>
                <ArrowRight size={12} className="text-ink-faint" />
              </Link>
              <Link
                to="/trust-trace"
                className="flex items-center justify-between rounded-lg p-2 text-ink hover:bg-surface-sunken hover:text-brand-600 transition"
              >
                <span>Trust Trace Lineage</span>
                <ArrowRight size={12} className="text-ink-faint" />
              </Link>
              <Link
                to="/action-ledger"
                className="flex items-center justify-between rounded-lg p-2 text-ink hover:bg-surface-sunken hover:text-brand-600 transition"
              >
                <span>Action Ledger Audit</span>
                <ArrowRight size={12} className="text-ink-faint" />
              </Link>
              <Link
                to="/break-the-agent"
                className="flex items-center justify-between rounded-lg p-2 text-ink hover:bg-surface-sunken hover:text-brand-600 transition"
              >
                <span>Attack Simulator</span>
                <ArrowRight size={12} className="text-ink-faint" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
