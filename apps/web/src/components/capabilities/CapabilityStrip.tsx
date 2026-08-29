/**
 * Shared "is the AI Growth & Agentic Commerce capability active?" strip —
 * used on both Overview (command-center glance) and Settings/Capabilities
 * (full detail). One data source (`useSystemCapabilities`), one rendering
 * of it, so the two pages can never silently drift apart.
 */
import type { SystemCapabilitiesDTO } from "@razorgrowth/contracts";
import { useSystemCapabilities } from "../../hooks/use-api";
import { CapabilityStatusBadge } from "../ui/StatusBadge";
import { Skeleton, ErrorState } from "../ui/States";

const ROWS: { key: keyof SystemCapabilitiesDTO; label: string }[] = [
  { key: "buyerDiscovery", label: "Buyer Discovery" },
  { key: "catalogGrounding", label: "Catalog Grounding" },
  { key: "growthIntelligence", label: "Growth Intelligence" },
  { key: "policy", label: "Policy" },
  { key: "checkout", label: "Checkout" },
  { key: "paymentProvider", label: "Razorpay" },
  { key: "recovery", label: "Recovery" },
  { key: "ledger", label: "Ledger" },
];

export function CapabilityStrip() {
  const capabilities = useSystemCapabilities();

  if (capabilities.isLoading) return <Skeleton className="h-16 w-full" />;
  if (capabilities.isError || !capabilities.data) {
    return <ErrorState message="Could not load system capabilities." onRetry={() => capabilities.refetch()} />;
  }

  const data = capabilities.data;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ROWS.map((row) => (
        <div key={row.key} className="rounded-card bg-surface-subtle px-3 py-2.5">
          <p className="mb-1.5 text-xs text-ink-faint">{row.label}</p>
          <CapabilityStatusBadge status={data[row.key]} />
        </div>
      ))}
    </div>
  );
}
