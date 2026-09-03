/**
 * What the shopper is allowed to spend, shown while they are shopping.
 *
 * WHERE THIS CAME FROM
 *
 * This was the only part of a separate "Home" screen worth keeping. That
 * screen also carried a hero with a button to the Buyer Agent, a "recent
 * orders" list that repeated the Orders page, and a card linking to
 * Discover — three restatements of the navigation, on the first screen a
 * shopper saw after signing in.
 *
 * The envelope is different: it is the one fact that changes what the
 * agent may do next, and the only place it was visible was a screen the
 * shopper left immediately. It belongs beside the conversation, because
 * "your agent can spend ₹X more today without asking you" is context for
 * the message you are about to send, not a destination.
 *
 * The daily figure is computed from the same proposals the merchant
 * console counts, using the same committed-status set the server's own
 * allowance reservation uses — so this strip and the gate that refuses a
 * purchase cannot disagree about what has been spent today.
 */
import { Link } from "react-router-dom";
import { Package, ShieldCheck, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api-client";
import { useBuyerSpendingPolicy } from "../../hooks/use-api";
import { formatMoney } from "../../lib/format";
import { Card, CardBody } from "../ui/Card";
import { Skeleton } from "../ui/States";

interface Purchase {
  id: string;
  outcome: string;
  settlementStatus: string | null;
  computedTotalMinor: number | null;
  internalOrderId: string | null;
  createdAt: string;
}

/** Statuses that represent money committed today. Mirrors the server's
 * own daily-allowance reservation, which counts everything except an
 * un-authorized proposal and a failed attempt. */
const COMMITTED = new Set(["EXECUTING", "PAYMENT_PENDING", "SETTLED", "UNKNOWN"]);

export function SpendingEnvelopeStrip() {
  const policy = useBuyerSpendingPolicy();
  const purchases = useQuery({
    queryKey: ["buyer", "purchases"],
    queryFn: () => apiGet<{ items: Purchase[] }>("/buyer/purchase-proposals"),
  });

  if (policy.isPending || purchases.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-3" role="status" aria-label="Loading your spending envelope">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  // A missing envelope must never block the conversation itself.
  if (policy.isError || purchases.isError || !policy.data) return null;

  const items = purchases.data?.items ?? [];
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const spentTodayMinor = items
    .filter((p) => COMMITTED.has(p.settlementStatus ?? "") && new Date(p.createdAt) >= startOfDay)
    .reduce((total, p) => total + (p.computedTotalMinor ?? 0), 0);
  const orders = items.filter((p) => p.internalOrderId);
  const awaiting = items.filter((p) => p.settlementStatus === "PROPOSED" && p.outcome !== "DECLINE");

  const currency = policy.data.currency;
  const dailyLimitMinor = policy.data.dailyLimitMinor;
  const usedPct = dailyLimitMinor > 0 ? Math.min(100, Math.round((spentTodayMinor / dailyLimitMinor) * 100)) : 0;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardBody className="py-4">
          <Wallet size={16} className="text-brand-600" aria-hidden />
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{formatMoney({ amountMinor: spentTodayMinor, currency })}</p>
          <p className="mt-0.5 text-xs text-ink-muted">Committed today of {formatMoney({ amountMinor: dailyLimitMinor, currency })}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={usedPct >= 90 ? "h-full rounded-full bg-danger" : usedPct >= 60 ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-brand-600"}
              style={{ width: `${usedPct}%` }}
              role="progressbar"
              aria-valuenow={usedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Share of your daily limit committed today"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="py-4">
          <Package size={16} className="text-brand-600" aria-hidden />
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{orders.length}</p>
          <p className="mt-0.5 text-xs text-ink-muted">Orders your agent has placed</p>
          <Link
            to="/customer/orders"
            className="mt-3 inline-block rounded text-xs font-medium text-brand-600 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            View orders →
          </Link>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="py-4">
          <ShieldCheck size={16} className="text-brand-600" aria-hidden />
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{awaiting.length}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {awaiting.length === 1 ? "Proposal waiting on you" : "Proposals waiting on you"}
          </p>
          <Link
            to="/customer/policy"
            className="mt-3 inline-block rounded text-xs font-medium text-brand-600 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Spending policy →
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
