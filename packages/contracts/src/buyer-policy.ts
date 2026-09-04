import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";

/**
 * The ceilings a buyer may configure, as named constants BECAUSE THE READ
 * AND WRITE SHAPES MUST AGREE.
 *
 * They did not. The read schema had no maximum at all and the update
 * schema capped everything at `MAX_SINGLE_PURCHASE_MINOR`, so the server
 * happily returned a policy it would then refuse to accept back. Every
 * save of the seeded buyer's policy failed with a bare VALIDATION_ERROR —
 * they could not even LOWER a limit, which is the one direction that
 * should never be blocked.
 *
 * A DAY IS A SUM, SO ITS CEILING CANNOT BE ONE PURCHASE'S CEILING.
 *
 * That was the modelling error underneath: `dailyLimitMinor` bounds the
 * total across purchases, and capping it at the single-purchase maximum
 * makes "up to ₹10,00,000 per purchase, a few times a day" impossible to
 * express — a perfectly coherent policy the form would not save.
 */
export const MAX_SINGLE_PURCHASE_MINOR = 100_000_000; // ₹10,00,000
/** Ten single-purchase maximums. Bounded so a typo cannot authorise an
 * unbounded day, generous enough to hold any policy the product itself
 * seeds or defaults to. */
export const MAX_DAILY_SPEND_MINOR = MAX_SINGLE_PURCHASE_MINOR * 10; // ₹1,00,00,000

export const buyerSpendingPolicySchema = z.object({
  id: z.string().uuid(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  // Bounded by the SAME constants the update shape uses, so anything this
  // endpoint can return is something the update endpoint will accept.
  autonomousPurchaseLimitMinor: z.number().int().min(0).max(MAX_SINGLE_PURCHASE_MINOR),
  dailyLimitMinor: z.number().int().min(0).max(MAX_DAILY_SPEND_MINOR),
  allowedCategories: z.array(z.string()),
  /** Explicit "every category is permitted". Never inferred from a
   *  magic word inside `allowedCategories` — see resolve-policy.ts. */
  allowAllCategories: z.boolean(),
  approvalRequiredAboveLimit: z.boolean(),

  // ── PART 12 ────────────────────────────────────────────────────────
  /** HARD ceiling: a purchase above this is DECLINED, never offered for
   * approval. Distinct from `autonomousPurchaseLimitMinor`, which is the
   * point above which the buyer is merely ASKED. */
  maxPurchaseAmountMinor: z.number().int().min(0).max(MAX_SINGLE_PURCHASE_MINOR),
  /** Categories the agent may never buy from. BEATS `allowedCategories`
   * and `allowAllCategories` both — a prohibition that a wider allow list
   * could undo was never a prohibition. */
  restrictedCategories: z.array(z.string()),
  /** A ranking signal, never a gate. Enforcing it would silently turn "I
   * prefer running shoes" into "refuse to show me anything else". */
  preferredCategories: z.array(z.string()),
  /** Off makes every purchase a step-up, however small. It never
   * declines: wanting to approve each purchase is not refusing to make
   * them. */
  autoPurchaseEnabled: z.boolean(),
  /** Merchants the agent may never buy from. */
  restrictedMerchantIds: z.array(z.string()),

  updatedAt: z.string().datetime(),
});
export type BuyerSpendingPolicyDTO = z.infer<typeof buyerSpendingPolicySchema>;

export const buyerSpendingPolicyUpdateSchema = z
  .object({
    autonomousPurchaseLimitMinor: z.number().int().min(0).max(MAX_SINGLE_PURCHASE_MINOR),
    dailyLimitMinor: z.number().int().min(0).max(MAX_DAILY_SPEND_MINOR),
    allowedCategories: z.array(z.string().trim().min(1).max(100)).max(50),
    allowAllCategories: z.boolean().optional(),
    approvalRequiredAboveLimit: z.boolean(),

    // ── PART 12 ──────────────────────────────────────────────────────
    // Optional so a buyer flipping one switch does not have to resend
    // their whole envelope and risk clobbering a boundary they never
    // opened the form to change.
    maxPurchaseAmountMinor: z.number().int().min(0).max(MAX_SINGLE_PURCHASE_MINOR).optional(),
    restrictedCategories: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    preferredCategories: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    autoPurchaseEnabled: z.boolean().optional(),
    restrictedMerchantIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((value) => value.dailyLimitMinor >= value.autonomousPurchaseLimitMinor, {
    message: "Daily limit must be at least the autonomous purchase limit.",
  })
  /**
   * A hard maximum below the point at which the buyer is merely asked is
   * incoherent: everything between the two would be simultaneously
   * "approve this" and "never allowed". Refused at the edge rather than
   * resolved silently, because either resolution would be a guess about
   * which number the buyer meant.
   */
  .refine(
    (value) =>
      value.maxPurchaseAmountMinor === undefined ||
      value.maxPurchaseAmountMinor >= value.autonomousPurchaseLimitMinor,
    { message: "Maximum purchase amount must be at least the autonomous purchase limit." },
  )
  /**
   * A category on both lists is a contradiction the buyer should resolve,
   * not one this schema should silently decide — even though the engine
   * would correctly treat it as restricted.
   */
  .refine(
    (value) =>
      !value.restrictedCategories?.some((restricted) => value.allowedCategories.includes(restricted)),
    { message: "A category cannot be both allowed and restricted." },
  );
export type BuyerSpendingPolicyUpdateDTO = z.infer<typeof buyerSpendingPolicyUpdateSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * PART 12 — Agent Activity
 *
 * The buyer's record of what their agent actually did. Every event is a
 * row from the hash-chained `AgentAction` ledger, written at the time of
 * the action by the code that performed it. Nothing here is generated for
 * display, and a stage that did not happen is absent rather than shown as
 * a pending step nobody took.
 * ══════════════════════════════════════════════════════════════════════ */

/** The pipeline the spec names, in order. */
export const buyerActivityStageSchema = z.enum([
  "INTENT",
  "DISCOVERY",
  "COMPARISON",
  "RECOMMENDATION",
  "OFFER_CHECK",
  "POLICY",
  "AUTHORIZATION",
  "CHECKOUT",
  "PAYMENT",
  "ORDER",
]);
export type BuyerActivityStage = z.infer<typeof buyerActivityStageSchema>;

export const buyerActivityEventSchema = z.object({
  id: z.string().uuid(),
  stage: buyerActivityStageSchema,
  /** The ledger's own action type, kept so an auditor can trace the event
   * back to the exact row rather than to a friendly label. */
  actionType: z.string(),
  actor: z.string(),
  status: z.string(),
  /**
   * The reason recorded AT THE TIME of the action, carried verbatim.
   *
   * A structured fact — "Compared 2 products on 9 published catalogue
   * fields" — never model reasoning. Chain-of-thought has never been
   * stored in this ledger and this field does not introduce a path to it.
   */
  detail: z.string(),
  at: z.string().datetime(),
  /** Position in the workflow's hash chain. */
  sequence: z.number().int(),
});
export type BuyerActivityEventDTO = z.infer<typeof buyerActivityEventSchema>;

export const buyerActivityWorkflowSchema = z.object({
  workflowId: z.string(),
  startedAt: z.string().datetime(),
  /** The stages this workflow REACHED — not the full ten. A search that
   * never became a purchase genuinely has no payment stage. */
  reachedStages: z.array(buyerActivityStageSchema),
  events: z.array(buyerActivityEventSchema),
  /** The spending decision, when this workflow produced one. */
  outcome: z
    .object({
      policyOutcome: z.string(),
      explanation: z.string(),
      amountMinor: z.number().int().nullable(),
      currency: z.string().nullable(),
    })
    .nullable(),
});
export type BuyerActivityWorkflowDTO = z.infer<typeof buyerActivityWorkflowSchema>;

export const buyerActivityResponseSchema = z.object({
  workflows: z.array(buyerActivityWorkflowSchema),
  /** The canonical order, so a client renders a pipeline without
   * hardcoding a second copy of it. */
  stageOrder: z.array(buyerActivityStageSchema),
});
export type BuyerActivityResponseDTO = z.infer<typeof buyerActivityResponseSchema>;
