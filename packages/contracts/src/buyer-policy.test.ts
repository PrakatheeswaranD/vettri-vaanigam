/**
 * PART 14 — the buyer's spending policy must survive a round trip.
 *
 * WHAT THIS GUARDS
 *
 * Found by opening the spending-policy screen as a shopper and pressing
 * Save. It returned a bare 400 VALIDATION_ERROR, for every change, for the
 * only buyer in the database.
 *
 * The read schema had no maximum; the update schema capped every amount at
 * the single-purchase ceiling. So the server returned a policy — the one it
 * had seeded itself — that it would then refuse to accept back. The screen
 * could not be saved at all, which meant a buyer could not even LOWER a
 * limit. That is the one direction a spending control must never block.
 *
 * The property below is the real invariant, and it is worth more than a
 * test of either cap on its own: ANYTHING THE READ SHAPE ACCEPTS, THE
 * UPDATE SHAPE MUST ACCEPT. Change a ceiling in one place and this fails.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_DAILY_SPEND_MINOR,
  MAX_SINGLE_PURCHASE_MINOR,
  buyerSpendingPolicySchema,
  buyerSpendingPolicyUpdateSchema,
} from "./buyer-policy.js";

function readablePolicy(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    currency: "INR",
    autonomousPurchaseLimitMinor: MAX_SINGLE_PURCHASE_MINOR,
    dailyLimitMinor: MAX_DAILY_SPEND_MINOR,
    allowedCategories: ["Running Shoes"],
    allowAllCategories: false,
    approvalRequiredAboveLimit: true,
    maxPurchaseAmountMinor: MAX_SINGLE_PURCHASE_MINOR,
    restrictedCategories: [],
    preferredCategories: [],
    autoPurchaseEnabled: true,
    restrictedMerchantIds: [],
    updatedAt: "2026-09-04T08:45:00.000Z",
    ...over,
  };
}

/** The subset of a readable policy that the update endpoint takes back. */
function asUpdate(policy: ReturnType<typeof readablePolicy>) {
  return {
    autonomousPurchaseLimitMinor: policy.autonomousPurchaseLimitMinor,
    dailyLimitMinor: policy.dailyLimitMinor,
    allowedCategories: policy.allowedCategories,
    allowAllCategories: policy.allowAllCategories,
    approvalRequiredAboveLimit: policy.approvalRequiredAboveLimit,
    maxPurchaseAmountMinor: policy.maxPurchaseAmountMinor,
    restrictedCategories: policy.restrictedCategories,
    preferredCategories: policy.preferredCategories,
    autoPurchaseEnabled: policy.autoPurchaseEnabled,
    restrictedMerchantIds: policy.restrictedMerchantIds,
  };
}

describe("buyer spending policy — read and update must agree", () => {
  it("accepts an update built from a policy at every ceiling", () => {
    const policy = readablePolicy();
    expect(buyerSpendingPolicySchema.safeParse(policy).success).toBe(true);
    // The exact case that failed in the running app: the seeded buyer sits
    // at the daily ceiling, and every save was rejected.
    expect(buyerSpendingPolicyUpdateSchema.safeParse(asUpdate(policy)).success).toBe(true);
  });

  it("bounds the daily limit ABOVE the single-purchase limit", () => {
    // A day is a sum across purchases. Capping it at one purchase's
    // maximum made "₹10,00,000 a few times a day" impossible to express —
    // a coherent policy the form silently would not save.
    expect(MAX_DAILY_SPEND_MINOR).toBeGreaterThan(MAX_SINGLE_PURCHASE_MINOR);
  });

  it("refuses a daily limit below the autonomous limit", () => {
    const update = asUpdate(readablePolicy({ dailyLimitMinor: 1_000, autonomousPurchaseLimitMinor: 50_000 }));
    expect(buyerSpendingPolicyUpdateSchema.safeParse(update).success).toBe(false);
  });

  it("refuses a hard ceiling below the point the buyer is merely asked", () => {
    const update = asUpdate(readablePolicy({ autonomousPurchaseLimitMinor: 50_000, maxPurchaseAmountMinor: 1_000 }));
    expect(buyerSpendingPolicyUpdateSchema.safeParse(update).success).toBe(false);
  });

  it("refuses a category that is both allowed and restricted", () => {
    const update = asUpdate(readablePolicy({ allowedCategories: ["Hydration"], restrictedCategories: ["Hydration"] }));
    expect(buyerSpendingPolicyUpdateSchema.safeParse(update).success).toBe(false);
  });

  it("still refuses an amount past the ceiling", () => {
    // Raising a cap to fix the round trip must not have removed it.
    const update = asUpdate(readablePolicy({ dailyLimitMinor: MAX_DAILY_SPEND_MINOR + 1 }));
    expect(buyerSpendingPolicyUpdateSchema.safeParse(update).success).toBe(false);
    const single = asUpdate(readablePolicy({ autonomousPurchaseLimitMinor: MAX_SINGLE_PURCHASE_MINOR + 1 }));
    expect(buyerSpendingPolicyUpdateSchema.safeParse(single).success).toBe(false);
  });
});
