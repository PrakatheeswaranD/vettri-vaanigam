/**
 * Centralized formatting (PART 01 §74, §75). Every component formats
 * money and dates through these — no `/ 100` or `toLocaleDateString()`
 * calls scattered across components, and formatting never feeds back into
 * an authoritative value.
 */
import type { MoneyDTO } from "@razorgrowth/contracts";

const CURRENCY_LOCALE: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
};

export function formatMoney(money: MoneyDTO): string {
  const locale = CURRENCY_LOCALE[money.currency] ?? "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
  }).format(money.amountMinor / 100);
}

/** Display-only: renders integer basis points as a percentage string
 * (e.g. `1000` → `"10%"`). Never used for arithmetic — the domain
 * package's own bps math is the only authoritative calculation. */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
