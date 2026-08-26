/**
 * Authoritative money primitive for RazorGrowth AI.
 *
 * PART 00 §16 (NON-NEGOTIABLE): financial amounts are integer minor units,
 * never floating point. ₹4,999.50 is represented as
 * `{ amountMinor: 499950, currency: "INR" }`, never as `4999.50`.
 *
 * This module is the ONLY place authoritative money arithmetic happens.
 * Formatting for display lives elsewhere (apps/web) and must never feed
 * back into authoritative values.
 */

/**
 * Minimal ISO 4217 allowlist for this project. Extend deliberately — an
 * unbounded currency allowlist would let unvalidated input reach financial
 * arithmetic.
 */
export const SUPPORTED_CURRENCIES = ["INR", "USD"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export interface MoneyJSON {
  amountMinor: number;
  currency: CurrencyCode;
}

/**
 * Immutable money value. Construct only via `Money.of` / `Money.zero` so
 * every instance in the system has already passed validation — there is
 * no way to hold an invalid Money value.
 */
export class Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;

  private constructor(amountMinor: number, currency: CurrencyCode) {
    this.amountMinor = amountMinor;
    this.currency = currency;
  }

  static of(amountMinor: number, currency: string): Money {
    if (typeof amountMinor !== "number" || Number.isNaN(amountMinor) || !Number.isFinite(amountMinor)) {
      throw new MoneyError(`Money amount must be a finite number, got: ${String(amountMinor)}`);
    }
    if (!Number.isInteger(amountMinor)) {
      throw new MoneyError(
        `Money amount must be an integer number of minor units, got: ${amountMinor}. ` +
          "Fractional minor units indicate a float leaked into financial arithmetic.",
      );
    }
    if (!Number.isSafeInteger(amountMinor)) {
      throw new MoneyError(`Money amount exceeds safe integer range: ${amountMinor}`);
    }
    if (!isSupportedCurrency(currency)) {
      throw new MoneyError(`Unsupported currency: ${String(currency)}`);
    }
    return new Money(amountMinor, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.of(0, currency);
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.of(json.amountMinor, json.currency);
  }

  toJSON(): MoneyJSON {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (this.currency !== other.currency) {
      throw new MoneyError(
        `Cannot ${operation} amounts in different currencies: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, "add");
    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, "subtract");
    return Money.of(this.amountMinor - other.amountMinor, this.currency);
  }

  /** Scale by a non-negative integer quantity (e.g. unit price × quantity). */
  multiplyByQuantity(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new MoneyError(`Quantity must be a non-negative integer, got: ${quantity}`);
    }
    return Money.of(this.amountMinor * quantity, this.currency);
  }

  isZero(): boolean {
    return this.amountMinor === 0;
  }

  isNegative(): boolean {
    return this.amountMinor < 0;
  }

  isPositive(): boolean {
    return this.amountMinor > 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other, "compare");
    return this.amountMinor > other.amountMinor;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other, "compare");
    return this.amountMinor < other.amountMinor;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.equals(other) || this.greaterThan(other);
  }

  lessThanOrEqual(other: Money): boolean {
    return this.equals(other) || this.lessThan(other);
  }
}
