import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { currencySchema, moneySchema } from "./common.js";

export const merchantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
  businessCategory: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MerchantDTO = z.infer<typeof merchantSchema>;

/**
 * Deterministic policy configuration (PART 00 §11; PART 01 §11; PART 05
 * §11-§13). This is the data the real Policy Engine (`@razorgrowth/domain`
 * `evaluatePolicy`, `apps/api` `modules/policy`) reads to decide ALLOW /
 * DENY / REQUIRE_APPROVAL — it is data, never decision logic itself.
 *
 * Superseded the PART 01 placeholder shape (`maxDiscountPercent` as a
 * single ceiling, no distinction between a hard limit and an auto-approval
 * threshold) once PART 05 actually needed that distinction (PART 00 §54 —
 * evolving a read-only placeholder is not the same as silently weakening
 * an already-enforced contract, since nothing enforced the old shape yet).
 */
export const merchantPolicySchema = z.object({
  merchantId: z.string().uuid(),
  policyVersion: z.number().int().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES),
  /** Basis points throughout (500 = 5%) — never a bare percent, matching
   * every other bps-denominated boundary in the system. */
  maxDiscountBps: z.number().int().min(0).max(10_000),
  autoApprovalDiscountBps: z.number().int().min(0).max(10_000),
  maxOrderAmount: moneySchema,
  autoApprovalOrderAmount: moneySchema,
  maxRecoveryAttempts: z.number().int().min(0),
  /**
   * PART 08 — the automation boundaries.
   *
   * Every field below is enforced by `evaluatePolicy`, a pure function the
   * API calls before anything executes. None of it is enforced by the
   * console: a hidden button is a hint, and the server is the control.
   */
  /** Minimum gross margin a discounted line must leave. A discount that
   * would sell below this is DENIED, not sent for approval — a floor is
   * set precisely so nobody decides case by case. */
  minMarginBps: z.number().int().min(0).max(10_000),
  /** Ceiling on actions the agent may take UNATTENDED in one UTC day.
   * Does not apply while a merchant is present and pressing the button. */
  maxAutonomousActionsPerDay: z.number().int().min(0),
  /** Whether automated payment recovery is permitted at all. Distinct from
   * `maxRecoveryAttempts`, which bounds retries once it is. */
  recoveryEnabled: z.boolean(),
  /** Action types the agent may NEVER take, whatever else permits them. */
  prohibitedActions: z.array(z.string()),
  /** Categories the agent may act on. EMPTY MEANS ALL. */
  eligibleCategories: z.array(z.string()),
  /** Paid orders a customer needs before the agent may target them. */
  minCustomerPaidOrders: z.number().int().min(0),
  proposalValidityMinutes: z.number().int().min(1),
  approvalValidityMinutes: z.number().int().min(1),
  authorizationValidityMinutes: z.number().int().min(1),
  updatedAt: z.string().datetime(),
});
export type MerchantPolicyDTO = z.infer<typeof merchantPolicySchema>;

/** PART 05 §75-§76 — merchant-editable subset only; `merchantId`,
 * `policyVersion`, and `updatedAt` are always server-derived. */
export const merchantPolicyUpdateSchema = z.object({
  maxDiscountBps: z.number().int().min(0).max(10_000),
  autoApprovalDiscountBps: z.number().int().min(0).max(10_000),
  maxOrderAmountMinor: z.number().int().min(0),
  autoApprovalOrderAmountMinor: z.number().int().min(0),
  maxRecoveryAttempts: z.number().int().min(0),
  /**
   * PART 08 — the automation boundaries.
   *
   * Every field below is enforced by `evaluatePolicy`, a pure function the
   * API calls before anything executes. None of it is enforced by the
   * console: a hidden button is a hint, and the server is the control.
   */
  /**
   * OPTIONAL, unlike the fields above.
   *
   * The eight original fields are required because this contract has
   * always been "send the whole policy". These six arrived later, and
   * making them required too would have turned every existing caller's
   * request into a 400 — a breaking change to a live contract in exchange
   * for nothing. Omitted means "leave as it is", never "reset to
   * default": a merchant who opens the form to change a discount ceiling
   * must not silently clear their own prohibitions.
   */
  minMarginBps: z.number().int().min(0).max(10_000).optional(),
  maxAutonomousActionsPerDay: z.number().int().min(0).optional(),
  recoveryEnabled: z.boolean().optional(),
  prohibitedActions: z.array(z.string()).optional(),
  eligibleCategories: z.array(z.string()).optional(),
  minCustomerPaidOrders: z.number().int().min(0).optional(),
  proposalValidityMinutes: z.number().int().min(1),
  approvalValidityMinutes: z.number().int().min(1),
  authorizationValidityMinutes: z.number().int().min(1),
});
export type MerchantPolicyUpdateDTO = z.infer<typeof merchantPolicyUpdateSchema>;

export const merchantStatsSchema = z.object({
  productCount: z.number().int().min(0),
  orderCount: z.number().int().min(0),
  capturedPayments: z.number().int().min(0),
  failedPayments: z.number().int().min(0),
  outOfStockVariants: z.number().int().min(0),
});
export type MerchantStatsDTO = z.infer<typeof merchantStatsSchema>;

/**
 * The seller-side commerce overview: what was actually earned, from whom,
 * and what came in recently.
 *
 * ONE RULE, APPLIED THROUGHOUT: money means PAID.
 *
 * Every monetary figure and every average here is derived from orders in
 * status `PAID` and from provider-confirmed captured payments — never from
 * orders in any status. Summing every order regardless of status counts
 * cancelled and failed baskets as revenue, which overstates the business
 * and disagrees with the Revenue Opportunity Engine, whose whole job is to
 * be the honest number.
 *
 * The counts are also whole-history counts, not the size of the page of
 * recent orders returned alongside them. `recentOrders` is a window for
 * the screen; `orderCount` is the truth.
 */
export const merchantCommerceOverviewSchema = z.object({
  analytics: z.object({
    /** Provider-confirmed captured payments only. */
    receivedRevenueMinor: z.number().int().min(0),
    capturedPaymentCount: z.number().int().min(0),
    /** Every order ever received, in any status. */
    orderCount: z.number().int().min(0),
    /** Of those, the ones that were actually paid for. */
    paidOrderCount: z.number().int().min(0),
    customerCount: z.number().int().min(0),
    /** Mean value of a PAID order across all history. Zero when nothing
     * has been paid for yet — an average over no observations is not a
     * number this refuses to invent. */
    averageOrderValueMinor: z.number().int().min(0),
    currency: currencySchema,
  }),
  recentOrders: z.array(
    z.object({
      id: z.string().uuid(),
      status: z.string(),
      totalAmountMinor: z.number().int(),
      currency: currencySchema,
      source: z.string().nullable(),
      createdAt: z.string(),
      customer: z
        .object({
          id: z.string().uuid(),
          displayName: z.string(),
          email: z.string().nullable(),
          segment: z.string().nullable(),
        })
        .nullable(),
      paymentState: z.string().nullable(),
      items: z.array(
        z.object({
          productNameSnapshot: z.string(),
          variantTitleSnapshot: z.string(),
          quantity: z.number().int(),
          lineTotalMinor: z.number().int(),
        }),
      ),
    }),
  ),
  /** How many orders `recentOrders` was capped at, so the console can say
   * "most recent 100" instead of implying it is the whole list. */
  recentOrderLimit: z.number().int().min(1),
  customers: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string(),
      email: z.string().nullable(),
      segment: z.string().nullable(),
      /** Orders placed, in any status. */
      orderCount: z.number().int().min(0),
      /** Of those, the ones actually paid for. */
      paidOrderCount: z.number().int().min(0),
      /** Sum of PAID orders only. */
      lifetimeValueMinor: z.number().int().min(0),
      /** Date of their last PAID order — an abandoned basket is not a
       * visit worth reporting as their last purchase. */
      lastPaidOrderAt: z.string().nullable(),
    }),
  ),
});
export type MerchantCommerceOverviewDTO = z.infer<typeof merchantCommerceOverviewSchema>;
