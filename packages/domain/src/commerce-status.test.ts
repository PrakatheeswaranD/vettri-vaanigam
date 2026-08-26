import { describe, expect, it } from "vitest";
import {
  isValidCartTransition,
  isValidCheckoutTransition,
  isValidOrderTransition,
} from "./commerce-status.js";

describe("Cart transitions (PART 06 §13-§14)", () => {
  it("allows ACTIVE -> CHECKOUT_PENDING -> CONVERTED", () => {
    expect(isValidCartTransition("ACTIVE", "CHECKOUT_PENDING")).toBe(true);
    expect(isValidCartTransition("CHECKOUT_PENDING", "CONVERTED")).toBe(true);
  });

  it("rejects a converted cart transitioning anywhere else", () => {
    expect(isValidCartTransition("CONVERTED", "ACTIVE")).toBe(false);
    expect(isValidCartTransition("CONVERTED", "CHECKOUT_PENDING")).toBe(false);
  });

  it("rejects skipping straight from ACTIVE to CONVERTED", () => {
    expect(isValidCartTransition("ACTIVE", "CONVERTED")).toBe(false);
  });
});

describe("Order transitions (PART 06 §34, §113)", () => {
  it("allows PENDING -> PAYMENT_PENDING -> PAID", () => {
    expect(isValidOrderTransition("PENDING", "PAYMENT_PENDING")).toBe(true);
    expect(isValidOrderTransition("PAYMENT_PENDING", "PAID")).toBe(true);
  });

  it("rejects PENDING -> PAID directly (must pass through PAYMENT_PENDING)", () => {
    expect(isValidOrderTransition("PENDING", "PAID")).toBe(false);
  });

  it("rejects any transition out of a fully terminal state", () => {
    expect(isValidOrderTransition("PAID", "CANCELLED")).toBe(false);
    expect(isValidOrderTransition("CANCELLED", "PENDING")).toBe(false);
  });

  it("PART 08 §35-§36: allows FAILED -> PAYMENT_PENDING as the one bounded recovery exception, nothing broader", () => {
    expect(isValidOrderTransition("FAILED", "PAYMENT_PENDING")).toBe(true);
    expect(isValidOrderTransition("FAILED", "PENDING")).toBe(false);
    expect(isValidOrderTransition("FAILED", "PAID")).toBe(false);
    expect(isValidOrderTransition("FAILED", "CANCELLED")).toBe(false);
  });
});

describe("Checkout transitions (PART 06 §40, §114)", () => {
  it("allows CREATED -> READY_FOR_PAYMENT", () => {
    expect(isValidCheckoutTransition("CREATED", "READY_FOR_PAYMENT")).toBe(true);
  });

  it("rejects PART 06 setting COMPLETED/FAILED directly from CREATED", () => {
    expect(isValidCheckoutTransition("CREATED", "COMPLETED")).toBe(false);
    expect(isValidCheckoutTransition("CREATED", "FAILED")).toBe(false);
  });

  it("rejects a completed checkout transitioning anywhere else", () => {
    expect(isValidCheckoutTransition("COMPLETED", "READY_FOR_PAYMENT")).toBe(false);
  });
});
