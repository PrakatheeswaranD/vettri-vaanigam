/**
 * "What can this system actually do?" (spec §8). Every flag here is real
 * merchant-scoped data — growth feature flags come straight from
 * `MerchantGrowthConfig` (the same row the Merchant Agent itself reads
 * before proposing anything), never a hardcoded marketing list.
 */
import { CheckCircle2, XCircle } from "lucide-react";
import { useGrowthConfig } from "../../hooks/use-merchant-agent";
import { useMerchantPolicy } from "../../hooks/use-api";
import { useSystemCapabilities } from "../../hooks/use-api";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Skeleton, ErrorState } from "../ui/States";

function FeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-card bg-surface-subtle px-3 py-2 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span
        className={
          "inline-flex items-center gap-1 text-xs font-medium " + (enabled ? "text-success-text" : "text-ink-faint")
        }
      >
        {enabled ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </div>
  );
}

export function CapabilitiesPanel() {
  const growthConfig = useGrowthConfig();
  const policy = useMerchantPolicy();
  const capabilities = useSystemCapabilities();

  if (growthConfig.isLoading || policy.isLoading || capabilities.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (growthConfig.isError || !growthConfig.data || policy.isError || !policy.data || capabilities.isError || !capabilities.data) {
    return <ErrorState message="Could not load capability configuration." onRetry={() => { growthConfig.refetch(); policy.refetch(); capabilities.refetch(); }} />;
  }

  const gc = growthConfig.data;
  const cap = capabilities.data;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>AI Growth</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <FeatureRow label="Cross-sell" enabled={gc.growthActionsEnabled && gc.crossSellEnabled} />
          <FeatureRow label="Upsell" enabled={gc.growthActionsEnabled && gc.upsellEnabled} />
          <FeatureRow label="Bundles" enabled={gc.growthActionsEnabled && gc.bundleEnabled} />
          <FeatureRow label="Bounded offers" enabled={gc.growthActionsEnabled && gc.boundedOffersEnabled} />
          <FeatureRow label="Payment recovery" enabled={policy.data.maxRecoveryAttempts > 0} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agentic Commerce</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <FeatureRow label="Buyer intent understanding" enabled={cap.buyerDiscovery === "READY"} />
          <FeatureRow label="Agent-readable catalog" enabled={cap.catalogGrounding === "READY"} />
          <FeatureRow label="Grounded recommendations" enabled={cap.catalogGrounding === "READY"} />
          <FeatureRow label="Checkout" enabled={cap.checkout === "READY"} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Governance</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <FeatureRow label="Policy enforcement" enabled={cap.policy === "ENFORCING"} />
          <FeatureRow label="Human approval" enabled />
          <FeatureRow label="Scoped authorization" enabled />
          <FeatureRow label="Payment verification" enabled />
          <FeatureRow label="Audit trail" enabled={cap.ledger === "ENABLED"} />
          <p className="pt-1 text-[11px] text-ink-faint">
            Approval, authorization, and payment verification are structural — always enforced by the code path,
            not a per-merchant toggle.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
