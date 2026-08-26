/**
 * Backend display-string formatting (PART 09 — centralizing what were
 * previously two independent ad hoc `/100` + symbol-lookup
 * implementations in `buyer-agent/service.ts` and
 * `merchant-agent/service.ts`). Display only — never feeds back into an
 * authoritative `amountMinor`/`Money` value; that arithmetic lives
 * exclusively in `@razorgrowth/domain`.
 */
const CURRENCY_SYMBOL: Record<string, string> = {
  INR: "₹",
};

export function formatMoney(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${symbol}${(amountMinor / 100).toFixed(2)}`;
}
