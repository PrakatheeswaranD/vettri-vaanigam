/**
 * Protocol conformance, actually executed.
 *
 * WHY THIS EXISTS
 *
 * The protocol surfaces were documented in the console — endpoint, method,
 * a sentence of explanation — and never called. Documentation of an
 * endpoint is indistinguishable from a working endpoint until something
 * invokes it, and the demo tour made that worse: a button labelled
 * "Simulate Inbound ACP & x402 Handshakes" fetched `/system/capabilities`
 * and reported success, which is a claim of verification that never
 * happened.
 *
 * So these checks make the real calls, from the browser, against the live
 * server, and show the status code that came back. Every surface used here
 * is public by design (see the unauthenticated allowlist in the API's auth
 * middleware) — an agent must be able to reach them before it has any
 * account with the merchant, which is exactly why a browser can too.
 *
 * BOTH DIRECTIONS ARE PASSES
 *
 * Half of these expect a REFUSAL. An unsigned mandate that gets rejected
 * is the gateway working; an unsigned mandate that gets accepted is the
 * finding. Each check therefore states the status it expects and passes
 * only on that, rather than treating any 2xx as good news — a conformance
 * panel that goes green when authentication breaks is worse than none.
 */
import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, Play, MinusCircle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

type Verdict = "PASS" | "FAIL" | "PENDING" | "RUNNING";

interface CheckResult {
  id: string;
  protocol: string;
  title: string;
  /** What a correct server does, in words, before the call is made. */
  expectation: string;
  verdict: Verdict;
  status?: number;
  detail?: string;
}

interface CheckSpec {
  id: string;
  protocol: string;
  title: string;
  expectation: string;
  run: (slug: string, sku: string | null) => Promise<{ ok: boolean; status: number; detail: string }>;
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function errorCode(body: unknown): string | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : null;
}

const CHECKS: CheckSpec[] = [
  {
    id: "discovery-catalog",
    protocol: "Discovery",
    title: "Agent-readable catalogue is published",
    expectation: "200 with schema.org JSON-LD an agent can read before it has any account",
    run: async (slug) => {
      const { status, body } = await call(`/agent-catalog/${slug}/.well-known/agent-catalog.json`);
      const context = (body as { "@context"?: unknown } | null)?.["@context"];
      const ok = status === 200 && Boolean(context);
      return { ok, status, detail: ok ? `JSON-LD served, @context present` : `Expected 200 with @context, got ${status}` };
    },
  },
  {
    id: "discovery-mcp",
    protocol: "Discovery",
    title: "MCP tool manifest is published",
    expectation: "200 naming the endpoint that accepts a purchase",
    run: async (slug) => {
      const { status, body } = await call(`/agent-catalog/${slug}/.well-known/mcp-manifest.json`);
      const tools = (body as { tools?: unknown } | null)?.tools;
      const ok = status === 200 && Array.isArray(tools) && tools.length > 0;
      return { ok, status, detail: ok ? `${(tools as unknown[]).length} tool(s) advertised` : `Expected 200 with a tools array, got ${status}` };
    },
  },
  {
    id: "x402-challenge",
    protocol: "x402 v2",
    title: "Unpaid request returns a real 402 challenge",
    expectation: "402 Payment Required carrying a priced `accepts` offer",
    run: async (slug, sku) => {
      if (!sku) return { ok: false, status: 0, detail: "No purchasable SKU found in the catalogue to quote." };
      const { status, body } = await call(`/x402/${slug}/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ sku, quantity: 1 }] }),
      });
      const accepts = (body as { accepts?: unknown } | null)?.accepts;
      const offer = Array.isArray(accepts) ? (accepts[0] as { amount?: string; network?: string } | undefined) : undefined;
      const ok = status === 402 && Boolean(offer?.amount);
      return {
        ok,
        status,
        detail: ok
          ? `Quoted ${offer?.amount} minor units on ${offer?.network}`
          : status === 503
            ? "x402 settlement is not configured on this server (X402_ASSET / X402_PAY_TO unset)."
            : `Expected 402 with an accepts offer, got ${status}`,
      };
    },
  },
  {
    id: "x402-forged",
    protocol: "x402 v2",
    title: "Forged payment header is refused",
    expectation: "A rejection — a payment proof the server did not issue must not settle",
    run: async (slug, sku) => {
      if (!sku) return { ok: false, status: 0, detail: "No purchasable SKU found in the catalogue." };
      const forged = btoa(JSON.stringify({ x402Version: 2, scheme: "exact", network: "eip155:84532", payload: { signature: "0xforged", authorization: {} } }));
      const { status, body } = await call(`/x402/${slug}/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json", "payment-signature": forged },
        body: JSON.stringify({ items: [{ sku, quantity: 1 }] }),
      });
      const ok = status >= 400 && status !== 404;
      return { ok, status, detail: ok ? `Refused: ${errorCode(body) ?? `HTTP ${status}`}` : `A forged payment header was NOT refused (got ${status}).` };
    },
  },
  {
    id: "acp-unsigned",
    protocol: "ACP 2026-04-17",
    title: "Unsigned checkout session is refused",
    expectation: "A rejection — ACP requires a detached signature, not a bare POST",
    run: async (slug) => {
      const { status, body } = await call(`/acp/${slug}/checkout_sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ id: "anything", quantity: 1 }] }),
      });
      const ok = status >= 400 && status !== 404;
      return {
        ok,
        status,
        detail: ok
          ? `Refused: ${errorCode(body) ?? `HTTP ${status}`}`
          : status === 404
            ? "ACP surface not mounted at this path."
            : `An unsigned ACP session was NOT refused (got ${status}).`,
      };
    },
  },
  {
    id: "gateway-unsigned",
    protocol: "Vettri Vaanigam gateway",
    title: "Intent without a signed mandate is refused",
    expectation: "A rejection — the mandate signature is the gate, not the session",
    run: async (slug) => {
      const { status, body } = await call(`/agent-gateway/${slug}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ basket: [{ sku: "anything", quantity: 1, unitPriceMinor: 1 }] }),
      });
      const ok = status >= 400 && status !== 404;
      return { ok, status, detail: ok ? `Refused: ${errorCode(body) ?? `HTTP ${status}`}` : `An unsigned intent was NOT refused (got ${status}).` };
    },
  },
  {
    id: "ap2-normalized",
    protocol: "AP2",
    title: "A cart-mandate envelope is recognised as AP2",
    expectation: "The adapter names the protocol AP2 — proving it parsed the envelope, not merely rejected it",
    run: async (slug, sku) => {
      const { status, body } = await call(`/agent-gateway/${slug}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cart_mandate: {
            contents: {
              payment_request: {
                details: {
                  total: { amount: { currency: "INR", value: "46.99" } },
                  displayItems: [{ label: sku ?? "UNKNOWN", amount: { currency: "INR", value: "46.99" } }],
                },
              },
            },
          },
        }),
      });
      const detected = (body as { protocol?: string; reasonCode?: string } | null)?.protocol;
      const ok = detected === "AP2";
      return {
        ok,
        status,
        detail: ok
          ? `Normalized as AP2, then declined ${(body as { reasonCode?: string } | null)?.reasonCode} — the shape was read, the identity was not trusted.`
          : `Expected the AP2 adapter to claim this envelope, got protocol=${detected ?? "null"}.`,
      };
    },
  },
  {
    id: "uap-normalized",
    protocol: "UAP",
    title: "A UAP agent/intent pair is recognised",
    expectation: "The adapter names the protocol UAP",
    run: async (slug, sku) => {
      const { status, body } = await call(`/agent-gateway/${slug}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uap_version: "1.0", agent: { id: "conformance-probe" }, intent: { items: [{ sku: sku ?? "UNKNOWN", quantity: 1 }] } }),
      });
      const detected = (body as { protocol?: string } | null)?.protocol;
      const ok = detected === "UAP";
      return { ok, status, detail: ok ? `Normalized as UAP, then declined ${(body as { reasonCode?: string } | null)?.reasonCode}.` : `Expected UAP, got protocol=${detected ?? "null"}.` };
    },
  },
  {
    id: "ucp-normalized",
    protocol: "UCP",
    title: "A UCP checkout basket is recognised",
    expectation: "The adapter names the protocol UCP",
    run: async (slug, sku) => {
      const { status, body } = await call(`/agent-gateway/${slug}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ucp_version: "2026-01-01", checkout: { items: [{ sku: sku ?? "UNKNOWN", quantity: 1 }] } }),
      });
      const detected = (body as { protocol?: string } | null)?.protocol;
      const ok = detected === "UCP";
      return { ok, status, detail: ok ? `Normalized as UCP, then declined ${(body as { reasonCode?: string } | null)?.reasonCode}.` : `Expected UCP, got protocol=${detected ?? "null"}.` };
    },
  },
  {
    id: "unknown-protocol",
    protocol: "Detection",
    title: "An unrecognised payload is not guessed at",
    expectation: "PROTOCOL_UNSUPPORTED with no protocol claimed — contents it cannot read are never interpreted",
    run: async (slug) => {
      const { status, body } = await call(`/agent-gateway/${slug}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonsense: true }),
      });
      const record = body as { protocol?: string | null; reasonCode?: string } | null;
      const ok = record?.reasonCode === "PROTOCOL_UNSUPPORTED" && !record?.protocol;
      return {
        ok,
        status,
        detail: ok
          ? "Refused as PROTOCOL_UNSUPPORTED with no protocol claimed."
          : `Expected PROTOCOL_UNSUPPORTED with protocol=null, got ${record?.reasonCode ?? status} / ${record?.protocol ?? "null"}.`,
      };
    },
  },
  {
    id: "gateway-price-forgery",
    protocol: "Vettri Vaanigam gateway",
    title: "Agent-claimed price is never trusted",
    expectation: "A rejection — the basket is priced from the merchant's catalogue",
    run: async (slug, sku) => {
      const { status, body } = await call(`/agent-gateway/${slug}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ basket: [{ sku: sku ?? "anything", quantity: 1, unitPriceMinor: 1 }], claimedTotalMinor: 1 }),
      });
      const ok = status >= 400 && status !== 404;
      return { ok, status, detail: ok ? `Refused: ${errorCode(body) ?? `HTTP ${status}`}` : `A ₹0.01 claim for a real product was NOT refused (got ${status}).` };
    },
  },
];

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  if (verdict === "RUNNING") return <Loader2 size={15} className="shrink-0 animate-spin text-brand-600" />;
  if (verdict === "PASS") return <CheckCircle2 size={15} className="shrink-0 text-success" />;
  if (verdict === "FAIL") return <XCircle size={15} className="shrink-0 text-danger" />;
  return <MinusCircle size={15} className="shrink-0 text-ink-faint" />;
}

export function LiveConformance({ slug }: { slug: string }) {
  const [results, setResults] = useState<CheckResult[]>(
    CHECKS.map((c) => ({ id: c.id, protocol: c.protocol, title: c.title, expectation: c.expectation, verdict: "PENDING" })),
  );
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);

  async function firstPurchasableSku(): Promise<string | null> {
    try {
      const { body } = await call(`/agent-catalog/${slug}/.well-known/agent-catalog.json`);
      const found = JSON.stringify(body).match(/"sku"\s*:\s*"([^"]+)"/);
      return found?.[1] ?? null;
    } catch {
      return null;
    }
  }

  async function runAll() {
    setRunning(true);
    setResults((prev) => prev.map((r) => ({ ...r, verdict: "RUNNING", status: undefined, detail: undefined })));
    const sku = await firstPurchasableSku();

    for (const check of CHECKS) {
      try {
        const outcome = await check.run(slug, sku);
        setResults((prev) =>
          prev.map((r) => (r.id === check.id ? { ...r, verdict: outcome.ok ? "PASS" : "FAIL", status: outcome.status, detail: outcome.detail } : r)),
        );
      } catch (error) {
        setResults((prev) =>
          prev.map((r) =>
            r.id === check.id ? { ...r, verdict: "FAIL", detail: error instanceof Error ? error.message : "Request failed" } : r,
          ),
        );
      }
    }
    setRanAt(new Date().toLocaleTimeString());
    setRunning(false);
  }

  const passed = results.filter((r) => r.verdict === "PASS").length;
  const failed = results.filter((r) => r.verdict === "FAIL").length;
  const done = passed + failed;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void runAll()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? "Running…" : "Run conformance checks"}
        </button>
        {done > 0 && !running ? (
          <span className="text-sm text-ink-muted">
            <strong className={failed === 0 ? "text-success-text" : "text-danger-text"}>{passed}/{results.length} passed</strong>
            {ranAt ? <span className="text-ink-faint"> · {ranAt}</span> : null}
          </span>
        ) : null}
      </div>

      <p className="text-micro text-ink-faint">
        Real HTTP calls to this server, made from your browser. Several checks pass only on a <strong>refusal</strong> —
        an unsigned mandate that succeeded would be the finding, not the pass.
      </p>

      <div className="space-y-1.5">
        {results.map((r) => (
          <div key={r.id} className="rounded-card border border-border-subtle bg-surface-subtle p-2.5">
            <div className="flex items-start gap-2">
              <VerdictIcon verdict={r.verdict} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-micro font-semibold text-ink-muted ring-1 ring-inset ring-border">
                    {r.protocol}
                  </span>
                  <p className="text-sm font-medium text-ink">{r.title}</p>
                  {typeof r.status === "number" && r.status > 0 ? (
                    <span className="ml-auto font-mono text-micro text-ink-faint">HTTP {r.status}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-micro text-ink-faint">Expects: {r.expectation}</p>
                {r.detail ? (
                  <p className={`mt-1 text-micro ${r.verdict === "FAIL" ? "text-danger-text" : "text-ink-muted"}`}>{r.detail}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
