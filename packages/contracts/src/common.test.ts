import { describe, expect, it } from "vitest";
import { moneySchema, paginationQuerySchema, MAX_PAGE_LIMIT } from "./common";

describe("moneySchema", () => {
  it("accepts a valid integer minor-unit amount with a supported currency", () => {
    const result = moneySchema.safeParse({ amountMinor: 499_950, currency: "INR" });
    expect(result.success).toBe(true);
  });

  it("rejects a fractional amount — the wire contract enforces integer minor units too", () => {
    const result = moneySchema.safeParse({ amountMinor: 499_950.5, currency: "INR" });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    const result = moneySchema.safeParse({ amountMinor: 100, currency: "XXX" });
    expect(result.success).toBe(false);
  });
});

describe("paginationQuerySchema", () => {
  it("applies safe defaults when page/limit are omitted", () => {
    const result = paginationQuerySchema.parse({});
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  it("coerces string query values (as arrive over HTTP) into numbers", () => {
    const result = paginationQuerySchema.parse({ page: "2", limit: "50" });
    expect(result).toEqual({ page: 2, limit: 50 });
  });

  it("rejects a limit above the server-enforced maximum (PART 01 §57)", () => {
    const result = paginationQuerySchema.safeParse({ limit: MAX_PAGE_LIMIT + 1 });
    expect(result.success).toBe(false);
  });
});
