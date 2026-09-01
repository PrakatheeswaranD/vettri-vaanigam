/**
 * The rail, made visible.
 *
 * WHY THIS PAGE EXISTS
 *
 * Three protocol adapters, a published JSON-LD catalogue, an MCP manifest
 * and real ACP endpoints were all built and tested — and none of them
 * appeared anywhere in the UI. Someone opening the console could see that
 * decisions had a protocol BADGE, and nothing else: no way to tell that a
 * real ACP surface exists, what an agent would call, or that the merchant
 * is genuinely discoverable.
 *
 * A gateway whose integration surface is invisible is indistinguishable
 * from a gateway that does not have one.
 *
 * HONESTY IS THE POINT OF THE FIDELITY BADGE
 *
 * ACP is implemented against the published spec. AP2 and x402 are
 * compatibility shims. That distinction is not buried in a footnote — it
 * is the most prominent thing on each card, because a jury being told
 * "three protocols" without it would be told something misleading.
 */
import { useState } from "react";
import { CheckCircle2, FlaskConical, Copy, Check, ExternalLink, FileJson, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { useMerchant } from "../hooks/use-api";
import { LiveConformance } from "../components/protocols/LiveConformance";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

interface Protocol {
  id: string;
  name: string;
  owner: string;
  fidelity: "SPEC_IMPLEMENTED" | "COMPATIBILITY_SHIM";
  fidelityNote: string;
  endpoints: { method: string; path: string; note: string }[];
}

function protocolsFor(slug: string): Protocol[] {
  return [
    {
      id: "acp",
      name: "Agentic Commerce Protocol",
      owner: "OpenAI / Stripe",
      fidelity: "SPEC_IMPLEMENTED",
      fidelityNote:
        "Built against the published open specification (2026-04-17), including the stateful session lifecycle and real idempotency-key semantics.",
      endpoints: [
        { method: "POST", path: `/acp/${slug}/checkout_sessions`, note: "Create a session — priced from your catalogue, not the agent's claim" },
        { method: "GET", path: `/acp/${slug}/checkout_sessions/{id}`, note: "Retrieve" },
        { method: "POST", path: `/acp/${slug}/checkout_sessions/{id}`, note: "Update and reprice" },
        { method: "POST", path: `/acp/${slug}/checkout_sessions/{id}/complete`, note: "The only endpoint that can move money — runs the full gate" },
        { method: "POST", path: `/acp/${slug}/checkout_sessions/{id}/cancel`, note: "Cancel" },
        { method: "POST", path: `/acp/${slug}/agentic_commerce/delegate_payment`, note: "Allowance-reference token (no card is vaulted)" },
      ],
    },
    {
      id: "x402",
      name: "x402",
      owner: "Coinbase",
      fidelity: "COMPATIBILITY_SHIM",
      fidelityNote:
        "The 402 challenge and X-PAYMENT retry are genuinely implemented. Settlement is NOT: no facilitator is called and nothing settles on-chain. Every response says so.",
      endpoints: [
        { method: "POST", path: `/x402/${slug}/purchase`, note: "Unpaid → 402 with a price quote; retry with X-PAYMENT → governed decision" },
      ],
    },
    {
      id: "ap2",
      name: "Agent Payments Protocol",
      owner: "Google",
      fidelity: "COMPATIBILITY_SHIM",
      fidelityNote:
        "Accepts the documented cart-mandate envelope and normalises it correctly. It does NOT verify SD-JWT verifiable credentials, so an AP2 mandate is accepted on its shape, never on its cryptography.",
      endpoints: [
        { method: "POST", path: `/agent-gateway/${slug}/intents`, note: "Shared intake — the mesh detects AP2 from the cart_mandate envelope" },
      ],
    },
  ];
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="shrink-0 rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
      aria-label={`Copy ${value}`}
    >
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
    </button>
  );
}

function FidelityBadge({ fidelity }: { fidelity: Protocol["fidelity"] }) {
  const spec = fidelity === "SPEC_IMPLEMENTED";
  return (
    <span
      className={
        spec
          ? "inline-flex items-center gap-1 rounded-pill bg-success-subtle px-2 py-0.5 text-micro font-semibold text-success-text ring-1 ring-inset ring-success-border"
          : "inline-flex items-center gap-1 rounded-pill bg-accent-subtle px-2 py-0.5 text-micro font-semibold text-accent-text ring-1 ring-inset ring-accent-border"
      }
    >
      {spec ? <CheckCircle2 size={11} /> : <FlaskConical size={11} />}
      {spec ? "Built to spec" : "Compatibility shim"}
    </span>
  );
}

export default function ProtocolsPage() {
  const merchant = useMerchant();
  const slug = merchant.data?.slug ?? "your-merchant";
  const protocols = protocolsFor(slug);

  const discovery = [
    {
      label: "Agent-readable catalogue",
      href: `${API_BASE}/agent-catalog/${slug}/.well-known/agent-catalog.json`,
      note: "schema.org Product/Offer JSON-LD — what a crawler or model toolchain already understands.",
    },
    {
      label: "MCP tool manifest",
      href: `${API_BASE}/agent-catalog/${slug}/.well-known/mcp-manifest.json`,
      note: "Names the one endpoint that accepts a purchase, and states the constraints up front so an agent can succeed on its first attempt.",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connect an Agent"
        lead="You publish one address. Any AI shopping agent can find your products and buy from them, whichever payment protocol it speaks — you do not integrate three times."
      />

      <Card>
        <CardHeader className="flex items-center gap-2">
          <FileJson size={16} className="text-brand-600" />
          <CardTitle>How an agent finds you</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {discovery.map((d) => (
            <div key={d.label} className="rounded-card border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">{d.label}</p>
                <a
                  href={d.href}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-micro font-medium text-brand-600 hover:underline"
                >
                  Open <ExternalLink size={11} />
                </a>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded bg-surface-sunken px-2 py-1 font-mono text-micro text-ink-muted">
                  {d.href}
                </code>
                <CopyButton value={d.href} />
              </div>
              <p className="mt-1.5 text-micro text-ink-faint">{d.note}</p>
            </div>
          ))}
          <p className="text-micro text-ink-faint">
            These are public on purpose. An agent has to read your catalogue before it can have an account with you,
            and they expose only what you already show human shoppers.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand-600" />
          <CardTitle>Prove it — run the protocols now</CardTitle>
        </CardHeader>
        <CardBody>
          <LiveConformance slug={slug} />
        </CardBody>
      </Card>

      <div className="space-y-4">
        {protocols.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex flex-wrap items-center gap-2">
              <CardTitle>{p.name}</CardTitle>
              <span className="text-micro text-ink-faint">{p.owner}</span>
              <span className="ml-auto">
                <FidelityBadge fidelity={p.fidelity} />
              </span>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm leading-relaxed text-ink-muted">{p.fidelityNote}</p>

              <div className="space-y-1.5">
                {p.endpoints.map((e) => (
                  <div key={e.path + e.method} className="rounded-card border border-border-subtle bg-surface-subtle p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-micro font-semibold text-ink-muted ring-1 ring-inset ring-border">
                        {e.method}
                      </span>
                      <code className="min-w-0 flex-1 truncate font-mono text-micro text-ink">{e.path}</code>
                      <CopyButton value={`${API_BASE}${e.path}`} />
                    </div>
                    <p className="mt-1 text-micro text-ink-faint">{e.note}</p>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What every agent has to satisfy</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2 text-sm text-ink-muted">
            {[
              "A signed spend permission scoped to you, with an amount cap and an expiry. Editing its terms invalidates the signature.",
              "One use only. A permission that already bought something cannot buy again.",
              "Your price, not theirs. Every protocol states a price on the wire; none of them is believed — the basket is priced from your catalogue and any disagreement stops the purchase.",
              "Above your limit is not a refusal. It becomes a payment link waiting for your approval.",
              "Every outcome, including refusals, carries a written reason.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
