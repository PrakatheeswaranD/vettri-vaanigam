/**
 * Every test here is a way re-issuing a checkout could take money twice or
 * sell stock that is gone. The happy path is one case; the refusals are
 * the point.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_REISSUE_STALE_AFTER_HOURS,
  evaluateCheckoutReissueEligibility,
  type CheckoutReissueInput,
} from "./checkout-reissue.js";

const abandoned: CheckoutReissueInput = {
  checkoutStatus: "READY_FOR_PAYMENT",
  orderStatus: "PENDING",
  paymentStates: ["CREATED"],
  ageHours: 30,
  inventoryStillReserved: true,
  windowStillOpen: false,
};

describe("re-issuing an abandoned checkout", () => {
  it("allows a genuinely abandoned basket back", () => {
    const decision = evaluateCheckoutReissueEligibility(abandoned);
    expect(decision.outcome).toBe("ELIGIBLE");
    expect(decision.reasonCodes).toContain("CHECKOUT_REISSUE_ALLOWED");
  });

  it("refuses when the order is already paid", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, orderStatus: "PAID" });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toEqual(expect.arrayContaining(["ORDER_ALREADY_PAID", "INTEGRITY_FAILURE"]));
  });

  it("refuses on a captured payment even when the session still looks unfinished", () => {
    // The exact shape that matters: the newest attempt is CREATED, so the
    // session reads as abandoned, while an earlier attempt took the money.
    const decision = evaluateCheckoutReissueEligibility({
      ...abandoned,
      checkoutStatus: "PAYMENT_IN_PROGRESS",
      paymentStates: ["CREATED", "CAPTURED"],
    });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("PAYMENT_MONEY_MOVED");
  });

  it("refuses on an authorized-but-uncaptured payment", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, paymentStates: ["AUTHORIZED"] });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("PAYMENT_MONEY_MOVED");
  });

  it("refuses on a refunded payment, because a refund implies a capture", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, paymentStates: ["REFUNDED"] });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("PAYMENT_MONEY_MOVED");
  });

  it("demands reconciliation rather than guessing on an UNKNOWN payment", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, paymentStates: ["UNKNOWN"] });
    expect(decision.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(decision.reasonCodes).toContain("PAYMENT_STATE_UNKNOWN");
  });

  it("refuses an EXPIRED session, whose stock has already gone back", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, checkoutStatus: "EXPIRED" });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("CHECKOUT_NOT_REISSUABLE");
  });

  it("refuses a COMPLETED session", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, checkoutStatus: "COMPLETED" });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
  });

  it("refuses once the reservation has been released, whatever the session says", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, inventoryStillReserved: false });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("INVENTORY_RELEASED");
  });

  it("refuses a checkout that is not yet stale — that buyer may still be deciding", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, ageHours: CHECKOUT_REISSUE_STALE_AFTER_HOURS - 1 });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("CHECKOUT_NOT_STALE");
  });

  it("refuses a checkout whose window is still open, so a re-issue cannot loop", () => {
    // Extending `expiresAt` does not make `createdAt` any younger, so
    // without this guard the agent could re-issue the same basket on every
    // cycle for ever.
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, windowStillOpen: true });
    expect(decision.outcome).toBe("NOT_ELIGIBLE");
    expect(decision.reasonCodes).toContain("CHECKOUT_WINDOW_STILL_OPEN");
  });

  it("becomes eligible exactly at the stale threshold, not one hour later", () => {
    const decision = evaluateCheckoutReissueEligibility({ ...abandoned, ageHours: CHECKOUT_REISSUE_STALE_AFTER_HOURS });
    expect(decision.outcome).toBe("ELIGIBLE");
  });

  it("checks money before session state, so a paid order cannot hide behind a stale session", () => {
    // Both conditions fail. The reported reason must be the money one:
    // "this checkout is EXPIRED" would send someone to fix the wrong thing.
    const decision = evaluateCheckoutReissueEligibility({
      ...abandoned,
      checkoutStatus: "EXPIRED",
      paymentStates: ["CAPTURED"],
    });
    expect(decision.reasonCodes).toContain("PAYMENT_MONEY_MOVED");
  });
});
