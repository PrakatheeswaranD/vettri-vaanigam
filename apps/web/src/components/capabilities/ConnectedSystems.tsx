/**
 * Connected systems (Part 11 §7) — what actually feeds this build.
 *
 * Deliberately honest: this project has no Shopify/WooCommerce
 * connector, so none is shown. Every row names a real internal data
 * source, `CONNECTED` appears only when rows genuinely exist, and the
 * AI provider row says plainly when the deterministic demo extractor is
 * standing in for a live model rather than claiming "configured".
 */
import { CheckCircle2, CircleDashed, AlertTriangle, ArrowRight } from "lucide-react";
import { useConnectedSystems } from "../../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Skeleton, ErrorState } from "../ui/States";

const STATUS_SPEC = {
  CONNECTED: { label: "Connected", className: "text-success-text", Icon: CheckCircle2 },
  NO_DATA: { label: "No data yet", className: "text-ink-faint", Icon: CircleDashed },
  NOT_CONFIGURED: { label: "Not configured", className: "text-warning-text", Icon: AlertTriangle },
} as const;

const PAYMENT_LABEL = {
  RAZORPAY_TEST_MODE: { label: "Razorpay Test Mode", className: "text-info-text", Icon: CheckCircle2 },
  MOCK_GATEWAY: { label: "Mock gateway (demo)", className: "text-warning-text", Icon: AlertTriangle },
  NOT_CONFIGURED: { label: "Not configured", className: "text-warning-text", Icon: AlertTriangle },
} as const;

const AI_LABEL = {
  LIVE_ANTHROPIC: { label: "Live Anthropic model", className: "text-success-text", Icon: CheckCircle2 },
  LIVE_GEMINI: { label: "Live Gemini model", className: "text-success-text", Icon: CheckCircle2 },
  DEMO_RULE_BASED: { label: "Deterministic demo extractor", className: "text-warning-text", Icon: AlertTriangle },
  DISABLED: { label: "Disabled", className: "text-ink-faint", Icon: CircleDashed },
} as const;

function Row({
  label,
  detail,
  spec,
}: {
  label: string;
  detail?: string;
  spec: { label: string; className: string; Icon: typeof CheckCircle2 };
}) {
  const { Icon } = spec;
  return (
    <div className="flex items-center justify-between gap-3 rounded-card bg-surface-subtle px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        {detail ? <p className="text-xs text-ink-faint">{detail}</p> : null}
      </div>
      <span className={"inline-flex shrink-0 items-center gap-1 text-xs font-medium " + spec.className}>
        <Icon size={13} />
        {spec.label}
      </span>
    </div>
  );
}

export function ConnectedSystems() {
  const systems = useConnectedSystems();

  if (systems.isLoading) return <Skeleton className="h-56 w-full" />;
  if (systems.isError || !systems.data) {
    return <ErrorState message="Could not load connected systems." onRetry={() => systems.refetch()} />;
  }

  const s = systems.data;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Connected Systems</CardTitle>
        <span className="text-xs text-ink-faint">Source: {s.source}</span>
      </CardHeader>
      <CardBody className="space-y-2">
        <Row label="Catalog" detail={`${s.counts.products} products`} spec={STATUS_SPEC[s.catalog]} />
        <Row label="Inventory" detail={`${s.counts.variants} variants`} spec={STATUS_SPEC[s.inventory]} />
        <Row label="Orders" detail={`${s.counts.orders} orders`} spec={STATUS_SPEC[s.orders]} />
        <Row label="Checkout" detail={`${s.counts.checkouts} sessions`} spec={STATUS_SPEC[s.checkout]} />
        <Row label="Payment provider" spec={PAYMENT_LABEL[s.paymentProvider]} />
        <Row label="AI provider" spec={AI_LABEL[s.aiProvider]} />

        <p className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-[11px] text-ink-faint">
          Commerce Source <ArrowRight size={11} /> CommerceGateway <ArrowRight size={11} /> Normalized commerce truth{" "}
          <ArrowRight size={11} /> AI / Growth / Governance
        </p>
      </CardBody>
    </Card>
  );
}
