/**
 * Discount authority visualization (Part 11 §10, §30).
 *
 * Renders the merchant's REAL configured policy boundaries — the two
 * thresholds the deterministic Policy Engine actually reads
 * (`autoApprovalDiscountBps`, `maxDiscountBps`) — as one continuous
 * authority scale. Nothing here is hardcoded: change the policy in
 * Guardrails and this bar moves with it.
 *
 * When `requestedBps` is supplied the marker shows where a specific
 * proposal landed, making "why did this need approval?" self-evident
 * without reading a reason code.
 */
import { formatBps } from "../../lib/format";

interface Props {
  autoApprovalBps: number;
  maxBps: number;
  /** A specific proposal's requested discount, if shown in context. */
  requestedBps?: number | null;
}

/** The scale always extends a little past the hard ceiling so the DENY
 * zone is visible as a real region rather than a zero-width edge. */
function scaleMaxBps(maxBps: number, requestedBps?: number | null): number {
  const headroom = Math.max(maxBps * 1.25, maxBps + 200);
  return Math.max(headroom, (requestedBps ?? 0) * 1.1, 100);
}

export function DiscountAuthorityBar({ autoApprovalBps, maxBps, requestedBps }: Props) {
  const scaleMax = scaleMaxBps(maxBps, requestedBps);
  const pct = (bps: number) => Math.min(100, Math.max(0, (bps / scaleMax) * 100));

  const autoWidth = pct(autoApprovalBps);
  const approvalWidth = Math.max(0, pct(maxBps) - autoWidth);
  const denyWidth = Math.max(0, 100 - autoWidth - approvalWidth);

  const zone =
    requestedBps == null
      ? null
      : requestedBps <= autoApprovalBps
        ? "AUTO"
        : requestedBps <= maxBps
          ? "APPROVAL"
          : "DENY";

  return (
    <div>
      <div className="relative pt-6">
        {requestedBps != null ? (
          <div
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${pct(requestedBps)}%` }}
          >
            <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {formatBps(requestedBps)}
            </span>
            <span className="mx-auto block h-2 w-px bg-ink" />
          </div>
        ) : null}

        <div className="flex h-3 w-full overflow-hidden rounded-full" role="img"
          aria-label={`Discount authority: automatic up to ${formatBps(autoApprovalBps)}, approval required up to ${formatBps(maxBps)}, denied above that.`}
        >
          <div className="bg-success" style={{ width: `${autoWidth}%` }} />
          <div className="bg-warning" style={{ width: `${approvalWidth}%` }} />
          <div className="bg-danger" style={{ width: `${denyWidth}%` }} />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="font-semibold text-success-text">AUTO</p>
          <p className="text-ink-muted">0 – {formatBps(autoApprovalBps)}</p>
        </div>
        <div>
          <p className="font-semibold text-warning-text">APPROVAL</p>
          <p className="text-ink-muted">
            {formatBps(autoApprovalBps)} – {formatBps(maxBps)}
          </p>
        </div>
        <div>
          <p className="font-semibold text-danger-text">DENY</p>
          <p className="text-ink-muted">above {formatBps(maxBps)}</p>
        </div>
      </div>

      {zone ? (
        <p className="mt-3 border-t border-border pt-2 text-xs text-ink-muted">
          Requested <span className="font-medium text-ink">{formatBps(requestedBps!)}</span> falls in the{" "}
          <span className="font-medium text-ink">{zone}</span> zone
          {zone === "AUTO"
            ? " — within the merchant's autonomous limit."
            : zone === "APPROVAL"
              ? " — a human must approve before authorization can be issued."
              : " — no approval can override this hard ceiling."}
        </p>
      ) : null}
    </div>
  );
}
