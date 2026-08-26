import { describe, expect, it } from "vitest";
import {
  canTransitionPaymentState,
  isTerminalPaymentState,
  PaymentStateError,
  transitionPaymentState,
} from "./payment-state";

describe("payment state machine", () => {
  it("allows CREATED -> AUTHORIZED -> CAPTURED", () => {
    expect(transitionPaymentState("CREATED", "AUTHORIZED")).toBe("AUTHORIZED");
    expect(transitionPaymentState("AUTHORIZED", "CAPTURED")).toBe("CAPTURED");
  });

  it("allows CREATED -> FAILED", () => {
    expect(transitionPaymentState("CREATED", "FAILED")).toBe("FAILED");
  });

  it("allows UNKNOWN to resolve to any concrete state", () => {
    expect(canTransitionPaymentState("UNKNOWN", "CAPTURED")).toBe(true);
    expect(canTransitionPaymentState("UNKNOWN", "FAILED")).toBe(true);
    expect(canTransitionPaymentState("UNKNOWN", "CANCELLED")).toBe(true);
  });

  it("rejects CAPTURED -> FAILED (terminal state cannot change)", () => {
    expect(canTransitionPaymentState("CAPTURED", "FAILED")).toBe(false);
    expect(() => transitionPaymentState("CAPTURED", "FAILED")).toThrow(PaymentStateError);
  });

  it("allows CREATED -> CAPTURED directly (PART 07 §54: auto-capture can skip a discrete AUTHORIZED event)", () => {
    expect(canTransitionPaymentState("CREATED", "CAPTURED")).toBe(true);
    expect(transitionPaymentState("CREATED", "CAPTURED")).toBe("CAPTURED");
  });

  it("rejects FAILED -> CREATED (no resurrecting a terminal record)", () => {
    expect(canTransitionPaymentState("FAILED", "CREATED")).toBe(false);
  });

  it("treats a same-state transition as an idempotent no-op (duplicate webhook)", () => {
    expect(canTransitionPaymentState("CAPTURED", "CAPTURED")).toBe(true);
    expect(transitionPaymentState("CAPTURED", "CAPTURED")).toBe("CAPTURED");
    expect(canTransitionPaymentState("CREATED", "CREATED")).toBe(true);
  });

  it("identifies terminal states correctly", () => {
    expect(isTerminalPaymentState("CAPTURED")).toBe(true);
    expect(isTerminalPaymentState("FAILED")).toBe(true);
    expect(isTerminalPaymentState("CANCELLED")).toBe(true);
    expect(isTerminalPaymentState("CREATED")).toBe(false);
    expect(isTerminalPaymentState("AUTHORIZED")).toBe(false);
    expect(isTerminalPaymentState("UNKNOWN")).toBe(false);
  });

  it("error carries the offending from/to states", () => {
    try {
      transitionPaymentState("CANCELLED", "CAPTURED");
      throw new Error("expected transitionPaymentState to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentStateError);
      const psError = err as PaymentStateError;
      expect(psError.from).toBe("CANCELLED");
      expect(psError.to).toBe("CAPTURED");
    }
  });
});
