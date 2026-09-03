/**
 * Vaanigam Console — the merchant's view of agent commerce.
 *
 * Three things, in the order a merchant cares about them: what the gateway
 * has decided (the log is the artifact of trust, not a demo prop), how it
 * is performing, and what rules it is enforcing.
 *
 * Every number here is measured. Where a figure cannot honestly be
 * computed — no decisions yet, or no comparison group for AOV lift — the
 * page says so rather than rendering a flattering zero.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, ExternalLink, Play, ChevronDown } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import {
  useDecisionLog,
  useGatewayMetrics,
  useGatewayPolicy,
  useSaveGatewayPolicy,
  useRunDemo,
  type DecisionLogEntry,
} from "../hooks/use-agent-gateway";
import { formatMoney } from "../lib/format";
import { AgentTrustPanel } from "../components/gateway/AgentTrustPanel";
import { PolicyComposer } from "../components/gateway/PolicyComposer";
import { NegotiationQueue } from "../components/gateway/NegotiationQueue";
import { StepUpQueue } from "../components/gateway/StepUpQueue";

const OUTCOME_STYLE: Record<DecisionLogEntry["outcome"], { icon: typeof CheckCircle2; cls: string; label: string }> = {
  AUTO_APPROVE: { icon: CheckCircle2, cls: "bg-success-subtle text-success-text", label: "Auto-approved" },
  STEP_UP: { icon: AlertTriangle, cls: "bg-warning-subtle text-warning-text", label: "Sent to you" },
  DECLINE: { icon: XCircle, cls: "bg-danger-subtle text-danger-text", label: "Declined" },
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function rupees(minor: number | null, currency: string | null): string {
  if (minor === null) return "—";
  // The API returns the currency as a plain string; the formatter wants the
  // narrowed union. Anything unrecognised falls back to the merchant's own
  // currency rather than rendering a bare number with no unit.
  const code = currency === "USD" ? "USD" : "INR";
  return formatMoney({ amountMinor: minor, currency: code });
}

const FILTERS: { label: string; value: DecisionLogEntry["outcome"] | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Auto-approved", value: "AUTO_APPROVE" },
  { label: "Sent to you", value: "STEP_UP" },
  { label: "Declined", value: "DECLINE" },
];

export default function AgentGatewayPage() {
  const [filter, setFilter] = useState<DecisionLogEntry["outcome"] | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const metrics = useGatewayMetrics();
  const decisions = useDecisionLog(filter);
  const runDemo = useRunDemo();
  const policy = useGatewayPolicy();
  const savePolicy = useSaveGatewayPolicy();

  const [form, setForm] = useState<{
    unknownAgentCeilingMajor: string;
    knownAgentCeilingMajor: string;
    blockedCategories: string;
    maxNegotiationDiscountPct: string;
    negotiatorMinBundleItems: string;
    negotiatorFloorMarginPct: string;
    velocityMaxIntentsPerHour: string;
  } | null>(null);

  // Seeded from the server once loaded, so the editor never shows stale
  // numbers a merchant might then "save" over a newer policy.
  useEffect(() => {
    if (!policy.data || form) return;
    setForm({
      unknownAgentCeilingMajor: String(policy.data.unknownAgentCeilingMinor / 100),
      knownAgentCeilingMajor: String(policy.data.knownAgentCeilingMinor / 100),
      blockedCategories: policy.data.blockedCategories.join(", "),
      maxNegotiationDiscountPct: String(policy.data.maxNegotiationDiscountBps / 100),
      negotiatorMinBundleItems: String(policy.data.negotiatorMinBundleItems),
      negotiatorFloorMarginPct: String(policy.data.negotiatorFloorMarginBps / 100),
      velocityMaxIntentsPerHour: String(policy.data.velocityMaxIntentsPerHour),
    });
  }, [policy.data, form]);

  function handleSave() {
    if (!form) return;
    savePolicy.mutate({
      unknownAgentCeilingMinor: Math.round(Number(form.unknownAgentCeilingMajor) * 100),
      knownAgentCeilingMinor: Math.round(Number(form.knownAgentCeilingMajor) * 100),
      blockedCategories: form.blockedCategories.split(",").map((c) => c.trim()).filter(Boolean),
      maxNegotiationDiscountBps: Math.round(Number(form.maxNegotiationDiscountPct) * 100),
      negotiatorMinBundleItems: Number(form.negotiatorMinBundleItems),
      negotiatorFloorMarginBps: Math.round(Number(form.negotiatorFloorMarginPct) * 100),
      velocityMaxIntentsPerHour: Number(form.velocityMaxIntentsPerHour),
    });
  }

  const m = metrics.data;

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title={"Agent Requests"}
          lead={"Every AI shopping agent that tried to buy from you, what you decided, and why. Nothing reaches a payment without both the buyer’s signed permission and your own rules agreeing."}
        />
      </div>

      <section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Auto-approval rate"
            value={m?.autoApprovalRatePct === null || m?.autoApprovalRatePct === undefined ? "—" : `${m.autoApprovalRatePct}%`}
            hint={m ? `${m.totalDecisions} decisions` : undefined}
          />
          <Metric
            label="Median decision latency"
            value={m?.medianDecisionLatencyMs == null ? "—" : `${m.medianDecisionLatencyMs}ms`}
            hint="To the decision, excluding optional upsell"
          />
          <Metric
            label="Decisions with a reason"
            value={m?.decisionsWithWrittenReasonPct == null ? "—" : `${m.decisionsWithWrittenReasonPct}%`}
            hint="Counted, not assumed"
          />
          <Metric
            label="Negotiator AOV lift"
            value={m?.negotiatorAovLiftPct == null ? "Not computable" : `${m.negotiatorAovLiftPct > 0 ? "+" : ""}${m.negotiatorAovLiftPct}%`}
            hint={m?.negotiatorAovLiftPct == null ? "No comparison group in this run" : "Observed difference, not a causal claim"}
          />
        </div>
        {m?.basis ? <p className="mt-2 text-xs text-ink-faint">{m.basis}</p> : null}
      </section>

      {/* Held orders come before everything else on this page: a
          decision someone is waiting on outranks a metric. */}
      <StepUpQueue />

      <NegotiationQueue />

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-2">
          <ShieldCheck size={16} className="text-brand-600" />
          <CardTitle>Decision log</CardTitle>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setFilter(f.value)}
                className={
                  filter === f.value
                    ? "rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-white"
                    : "rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:bg-surface-subtle"
                }
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => runDemo.mutate()}
              disabled={runDemo.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              <Play size={11} />
              {runDemo.isPending ? "Running five agents…" : "Run demo"}
            </button>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {runDemo.isError ? (
            <p className="rounded-card bg-danger-subtle px-3 py-2 text-xs text-danger-text">
              The demo script could not be started.
            </p>
          ) : null}
          {runDemo.data && !runDemo.data.ok ? (
            <pre className="overflow-x-auto rounded-card bg-danger-subtle px-3 py-2 text-[11px] text-danger-text">
              {runDemo.data.error ?? "The demo script exited non-zero."}
            </pre>
          ) : null}
          {runDemo.data?.ok ? (
            <p className="rounded-card bg-success-subtle px-3 py-2 text-xs text-success-text">
              Five agents ran in {(runDemo.data.durationMs / 1000).toFixed(1)}s — the log below is live.
            </p>
          ) : null}

          {decisions.isPending ? <p className="text-sm text-ink-muted">Loading decisions…</p> : null}
          {decisions.data?.items.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No agent has called this gateway yet. Run <code className="text-xs">pnpm demo:agent-swarm</code> to send five.
            </p>
          ) : null}

          {decisions.data?.items.map((d) => {
            const style = OUTCOME_STYLE[d.outcome];
            const Icon = style.icon;
            return (
              <div key={d.id} className="rounded-card border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.cls}`}>
                    <Icon size={11} />
                    {style.label}
                  </span>
                  {d.protocol ? (
                    <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-micro font-medium text-ink-muted">
                      {d.protocol}
                      {d.protocol !== "ACP" ? <span className="ml-1 text-accent-text">shim</span> : null}
                    </span>
                  ) : null}
                  {d.permissionType === "SIGNED_MANDATE" ? (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-success-subtle px-2 py-0.5 text-micro font-medium text-success-text">
                      <ShieldCheck size={10} /> signature verified
                    </span>
                  ) : d.permissionType === "UNSIGNED_ALLOWANCE" ? (
                    // Said plainly rather than dressed up as a verified
                    // mandate: the terms were checked, the cryptography
                    // was not.
                    <span className="rounded-pill bg-accent-subtle px-2 py-0.5 text-micro font-medium text-accent-text">
                      allowance, not signed
                    </span>
                  ) : null}
                  {d.agentTrust ? (
                    <span className="text-[11px] text-ink-faint">{d.agentTrust === "KNOWN" ? "known agent" : "unknown agent"}</span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-ink-faint">{d.decisionLatencyMs}ms</span>
                </div>

                <p className="mt-2 text-sm text-ink">{d.explanation}</p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                  <span>{d.externalAgentId ?? "unidentified agent"}</span>
                  <span>your price {rupees(d.computedTotalMinor, d.currency)}</span>
                  {d.claimedTotalMinor !== null && d.claimedTotalMinor !== d.computedTotalMinor ? (
                    <span className="text-danger-text">agent claimed {rupees(d.claimedTotalMinor, d.currency)}</span>
                  ) : null}
                  {d.appliedCeilingMinor !== null ? <span>ceiling {rupees(d.appliedCeilingMinor, d.currency)}</span> : null}
                  <span className="font-mono">{d.reasonCode}</span>
                  {d.providerOrderId ? <span className="font-mono text-success-text">{d.providerOrderId}</span> : null}
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink"
                >
                  <ChevronDown size={11} className={expanded === d.id ? "rotate-180 transition" : "transition"} />
                  {expanded === d.id ? "Hide" : "Show"} what the agent actually sent
                </button>

                {expanded === d.id ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-card bg-surface-subtle p-3 text-[11px] text-ink-muted">
                    {d.rawProtocolPayload
                      ? JSON.stringify(d.rawProtocolPayload, null, 2)
                      : "No payload was recorded for this decision."}
                  </pre>
                ) : null}

                {d.stepUpPaymentLinkUrl ? (
                  <a
                    href={d.stepUpPaymentLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                  >
                    Review and approve this order
                    <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <PolicyComposer
        policy={policy.data}
        applying={savePolicy.isPending}
        onApply={(proposed) => {
          // Applied through the SAME authenticated save the manual form
          // uses — same validation, same version bump, same audit. The
          // draft endpoint never had the authority to write this.
          savePolicy.mutate({
            unknownAgentCeilingMinor: proposed.unknownAgentCeilingMinor,
            knownAgentCeilingMinor: proposed.knownAgentCeilingMinor,
            blockedCategories: proposed.blockedCategories,
            maxNegotiationDiscountBps: proposed.maxNegotiationDiscountBps,
            negotiatorMinBundleItems: proposed.negotiatorMinBundleItems,
            negotiatorFloorMarginBps: proposed.negotiatorFloorMarginBps,
            velocityMaxIntentsPerHour: proposed.velocityMaxIntentsPerHour,
          });
          // Re-seed the manual form from what was just applied, so the two
          // editors cannot disagree about what is currently saved.
          setForm({
            unknownAgentCeilingMajor: String(proposed.unknownAgentCeilingMinor / 100),
            knownAgentCeilingMajor: String(proposed.knownAgentCeilingMinor / 100),
            blockedCategories: proposed.blockedCategories.join(", "),
            maxNegotiationDiscountPct: String(proposed.maxNegotiationDiscountBps / 100),
            negotiatorMinBundleItems: String(proposed.negotiatorMinBundleItems),
            negotiatorFloorMarginPct: String(proposed.negotiatorFloorMarginBps / 100),
            velocityMaxIntentsPerHour: String(proposed.velocityMaxIntentsPerHour),
          });
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Agent purchasing policy</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {policy.data?.configured === false ? (
            <p className="rounded-card bg-warning-subtle px-3 py-2 text-xs text-warning-text">
              No policy saved yet — the conservative defaults below are in force. Saving makes them explicitly yours.
            </p>
          ) : policy.data ? (
            <p className="text-xs text-ink-faint">Policy version {policy.data.policyVersion}. Each decision records the version that produced it.</p>
          ) : null}

          {form ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { key: "unknownAgentCeilingMajor" as const, label: "Auto-approve ceiling — unknown agent (₹)", hint: "Above this, an order goes to you instead of being charged." },
                { key: "knownAgentCeilingMajor" as const, label: "Auto-approve ceiling — known agent (₹)", hint: "Applies once an agent has settled an order with you." },
                { key: "maxNegotiationDiscountPct" as const, label: "Max negotiator discount (%)", hint: "Enforced in code. The model can never exceed it." },
                { key: "negotiatorMinBundleItems" as const, label: "Negotiator engages below N items", hint: "A fuller basket is a sale in hand — discounting it gives away margin." },
                { key: "negotiatorFloorMarginPct" as const, label: "Floor margin (%)", hint: "An offer that would go below this is refused outright, not reduced." },
                { key: "velocityMaxIntentsPerHour" as const, label: "Max intents per agent per hour", hint: "Past this, further attempts are declined." },
              ].map(({ key, label, hint }) => (
                <label key={key} className="block">
                  <span className="text-xs font-medium text-ink">{label}</span>
                  <input
                    type="number"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
                  />
                  <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>
                </label>
              ))}

              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-ink">Blocked categories</span>
                <input
                  type="text"
                  value={form.blockedCategories}
                  onChange={(e) => setForm({ ...form, blockedCategories: e.target.value })}
                  placeholder="Gift Cards, Vouchers"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
                />
                <span className="mt-1 block text-[11px] text-ink-faint">
                  Comma separated. No agent may buy these autonomously at any value.
                </span>
              </label>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Loading policy…</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form || savePolicy.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {savePolicy.isPending ? "Saving…" : "Save policy"}
            </button>
            {savePolicy.isSuccess ? <span className="text-xs text-success-text">Saved — version {savePolicy.data.policyVersion}.</span> : null}
            {savePolicy.isError ? <span className="text-xs text-danger-text">Could not save that policy.</span> : null}
          </div>
        </CardBody>
      </Card>

      <AgentTrustPanel policy={policy.data} />
    </div>
  );
}
