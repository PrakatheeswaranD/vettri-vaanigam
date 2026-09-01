/**
 * The shopper's landing screen.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * This page made no network request at all. It was a hero, a button, and
 * three cards of marketing copy — "Discover", "Stay in control", "Follow
 * every rupee" — that were not links, not data, and not actionable. The
 * first screen after signing in told a shopper nothing about their own
 * account: not what they had bought, not what their agent was allowed to
 * spend, not whether anything was waiting on them.
 *
 * It now reads the two things a buyer's home screen is actually for:
 * their spending envelope, and what their agent has recently done inside
 * it. Every figure comes from the server. The daily-spend number is
 * computed from the same proposals the merchant console counts, so this
 * screen and the gate cannot disagree about what has been committed
 * today.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Package, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { apiGet } from "../lib/api-client";
import { useBuyerSpendingPolicy } from "../hooks/use-api";
import { formatMoney, formatRelativeTime } from "../lib/format";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState, Skeleton } from "../components/ui/States";

interface PurchaseItem { productName: string | null; variantTitle: string | null; quantity: number }
interface Purchase {
  id: string;
  outcome: string;
  settlementStatus: string | null;
  computedTotalMinor: number | null;
  currency: "INR" | "USD" | null;
  internalOrderId: string | null;
  createdAt: string;
  merchant: { name: string };
  items: PurchaseItem[];
}

/** Statuses that represent money committed today. Mirrors the server's
 * own daily-allowance reservation, which counts everything except an
 * un-authorized proposal and a failed attempt. */
const COMMITTED = new Set(["EXECUTING", "PAYMENT_PENDING", "SETTLED", "UNKNOWN"]);

export default function CustomerHomePage() {
  const policy = useBuyerSpendingPolicy();
  const purchases = useQuery({
    queryKey: ["buyer", "purchases"],
    queryFn: () => apiGet<{ items: Purchase[] }>("/buyer/purchase-proposals"),
  });

  const items = purchases.data?.items ?? [];
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const spentTodayMinor = items
    .filter((p) => COMMITTED.has(p.settlementStatus ?? "") && new Date(p.createdAt) >= startOfDay)
    .reduce((total, p) => total + (p.computedTotalMinor ?? 0), 0);
  const orders = items.filter((p) => p.internalOrderId);
  const awaiting = items.filter((p) => p.settlementStatus === "PROPOSED" && p.outcome !== "DECLINE");
  const recent = orders.slice(0, 3);

  const dailyLimitMinor = policy.data?.dailyLimitMinor ?? 0;
  const usedPct = dailyLimitMinor > 0 ? Math.min(100, Math.round((spentTodayMinor / dailyLimitMinor) * 100)) : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-card border border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-7">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Customer · Buy with AI</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Tell your Buyer Agent what you need.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          It clarifies your intent, searches AI-readable catalogues, compares on fit rather than price alone, and brings
          back an explainable proposal. Nothing is charged until you authorize it.
        </p>
        <Link
          to="/customer/buyer-agent"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Start a search <ArrowRight size={15} aria-hidden />
        </Link>
      </section>

      {policy.isPending || purchases.isPending ? (
        <div className="grid gap-4 md:grid-cols-3" role="status" aria-label="Loading your account">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardBody>
              <Wallet size={16} className="text-brand-600" aria-hidden />
              <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
                {formatMoney({ amountMinor: spentTodayMinor, currency: "INR" })}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Committed today of {formatMoney({ amountMinor: dailyLimitMinor, currency: "INR" })}
              </p>
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
            <CardBody>
              <Package size={16} className="text-brand-600" aria-hidden />
              <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{orders.length}</p>
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
            <CardBody>
              <ShieldCheck size={16} className="text-brand-600" aria-hidden />
              <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{awaiting.length}</p>
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
      )}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Recent orders</CardTitle>
          <Link
            to="/customer/orders"
            className="rounded text-xs font-medium text-brand-600 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            View all
          </Link>
        </CardHeader>
        {purchases.isPending ? (
          <CardBody><Skeleton className="h-20" /></CardBody>
        ) : recent.length === 0 ? (
          <EmptyState
            title="Nothing bought yet"
            description="Ask the Buyer Agent for something and authorize the proposal it brings back."
            icon={<Bot size={18} />}
          />
        ) : (
          <ul className="divide-y divide-border-hair">
            {recent.map((purchase) => {
              const named = purchase.items.find((item) => item.productName);
              return (
                <li key={purchase.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {named?.productName ?? purchase.merchant.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {purchase.merchant.name} · {formatRelativeTime(purchase.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    {formatMoney({ amountMinor: purchase.computedTotalMinor ?? 0, currency: purchase.currency ?? "INR" })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Sparkles size={16} className="shrink-0 text-brand-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-ink-muted">
            Browse what AI-ready merchants publish, and open any product the way your agent reads it.
          </p>
          <Link
            to="/customer/discover"
            className="shrink-0 rounded-md border border-border px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Discover merchants
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
