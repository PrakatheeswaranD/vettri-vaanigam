import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@razorgrowth/domain";
import { agentReadableProductSchema } from "./agent-catalog.js";

/**
 * Buyer Agent wire contracts (PART 03 §11, §38, §48-§49, §60).
 *
 * `buyerIntentSchema` is the NORMALIZED, post-merge intent the frontend
 * renders in the "Interpreted Intent" panel — never the raw LLM/extractor
 * output, which is validated and normalized server-side first (PART 03
 * §23-§26) and never crosses the wire directly.
 */

export const BUYER_INTENT_SCHEMA_VERSION = "1.0" as const;
export const BUYER_MESSAGE_MAX_LENGTH = 500;

export const availabilityRequirementSchema = z.enum(["PURCHASABLE_ONLY", "INCLUDE_UNAVAILABLE"]);

export const buyerBudgetSchema = z.object({
  minMinor: z.number().int().min(0).nullable(),
  maxMinor: z.number().int().min(0).nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export const clarificationReasonCodeSchema = z.enum(["MISSING_CATEGORY"]);

export const buyerClarificationSchema = z.object({
  required: z.boolean(),
  reasonCode: clarificationReasonCodeSchema.nullable(),
  question: z.string().nullable(),
});

export const buyerIntentSchema = z.object({
  schemaVersion: z.literal(BUYER_INTENT_SCHEMA_VERSION),
  originalQuery: z.string(),
  category: z.string().nullable(),
  budget: buyerBudgetSchema,
  quantity: z.number().int().min(1).max(10),
  requiredAttributes: z.record(z.string(), z.string()),
  preferredAttributes: z.record(z.string(), z.string()),
  excludedAttributes: z.record(z.string(), z.array(z.string())),
  availabilityRequirement: availabilityRequirementSchema,
  confidence: z.number().min(0).max(1).nullable(),
});
export type BuyerIntentDTO = z.infer<typeof buyerIntentSchema>;

/** PART 03 §45 — a model may only ever propose from this fixed allowlist. */
export const recommendationReasonCodeSchema = z.enum([
  "WITHIN_BUDGET",
  "MATCHES_REQUIRED_ATTRIBUTE",
  "MATCHES_PREFERENCE",
  "IN_STOCK",
  "STRONG_METADATA",
  "NEAR_MATCH_BUDGET",
  "NEAR_MATCH_ATTRIBUTE",
]);
export type RecommendationReasonCodeDTO = z.infer<typeof recommendationReasonCodeSchema>;

export const constraintViolationTypeSchema = z.enum(["BUDGET_MAX", "BUDGET_MIN", "REQUIRED_ATTRIBUTE", "AVAILABILITY"]);

export const constraintViolationSchema = z.object({
  type: constraintViolationTypeSchema,
  expected: z.string(),
  actual: z.string(),
  differenceMinor: z.number().int().nullable(),
});
export type ConstraintViolationDTO = z.infer<typeof constraintViolationSchema>;

export const recommendationMatchTypeSchema = z.enum(["EXACT", "NEAR_MATCH"]);

export const recommendedProductSchema = z.object({
  productId: z.string().uuid(),
  /** The specific variant (size/color/etc.) that actually satisfies (or,
   * for a near match, comes closest to satisfying) the buyer's
   * constraints — a product can have several variants, only one of which
   * is the one being recommended. */
  variantId: z.string().uuid(),
  rank: z.number().int().min(1),
  matchType: recommendationMatchTypeSchema,
  reasonCodes: z.array(recommendationReasonCodeSchema),
  explanation: z.string(),
  violations: z.array(constraintViolationSchema),
  /** Authoritative, catalog-hydrated product data (PART 03 §39-§40, §119)
   * — never a model-invented price/availability. */
  product: agentReadableProductSchema,
});
export type RecommendedProductDTO = z.infer<typeof recommendedProductSchema>;

/** PART 03 §160 — explicit recommendation modes for auditability. */
export const recommendationModeSchema = z.enum([
  "AI_RANKED",
  "DETERMINISTIC_SINGLE_MATCH",
  "DETERMINISTIC_FALLBACK",
  "NEAR_MATCH",
  "NO_MATCH",
]);

/**
 * PART 03 §49 — adapted to a non-overlapping set: `NO_EXACT_MATCH` covers
 * both "near matches exist" and "not even a near match exists" (the
 * `recommendations` array distinguishes those, populated vs empty) so
 * there is exactly one status per real situation, never two statuses
 * describing the same outcome. `NO_RESULTS` is reserved for when the
 * deterministic catalog filter itself returned nothing to evaluate at all
 * (e.g. an unrecognized category) — a materially different, more absolute
 * outcome than "results existed but none matched".
 */
export const buyerAgentStatusSchema = z.enum([
  "RECOMMENDATIONS_READY",
  "CLARIFICATION_REQUIRED",
  "NO_EXACT_MATCH",
  "NO_RESULTS",
  "AI_UNAVAILABLE",
  "FAILED",

  // ── PART 09 — the turn was an ACTION, not a search ────────────────
  //
  // A buyer saying "compare these" or "buy the second one" is not
  // searching, and reporting a search result for it would answer a
  // question they did not ask. These statuses let the conversation carry
  // the whole pipeline — discovery through to a purchase proposal —
  // instead of handing the buyer off to an e-commerce site halfway.
  /** A deterministic side-by-side of what was already recommended. */
  "COMPARISON_READY",
  /** A purchase proposal exists. Money has NOT moved: the buyer's
   * spending policy decided, and anything above their autonomous limit is
   * waiting on their explicit authorization. */
  "PURCHASE_PROPOSED",
  /** The buyer asked to buy, and their own spending policy declined. */
  "PURCHASE_DECLINED",
  /** The buyer asked to act on something the conversation does not hold —
   * "buy the third" with two recommendations. Never resolved by guessing. */
  "ACTION_UNRESOLVED",

  // ── PART 10 ────────────────────────────────────────────────────────
  /**
   * The buyer authorized, and a real payment order now exists with the
   * provider. Money has still NOT moved: the charge requires completing
   * the provider's own checkout, which returns a signature the server
   * verifies. This status means "ready to be asked for payment".
   */
  "CHECKOUT_READY",
  /** Authorization was attempted and refused — expired proposal, policy
   * changed underneath it, daily allowance exhausted. Stated with the
   * server's own reason, never softened. */
  "AUTHORIZATION_REFUSED",
]);

export const aiProviderModeSchema = z.enum(["LIVE_ANTHROPIC", "LIVE_GEMINI", "DEMO_RULE_BASED", "DISABLED"]);

/** PART 03 §109-§111 — restrained pipeline trace for jury/dev
 * inspectability. Structured stage facts only, never chain-of-thought. */
export const buyerAgentTraceStageSchema = z.object({
  stage: z.string(),
  detail: z.string(),
});

export const buyerMessageRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(BUYER_MESSAGE_MAX_LENGTH),
});
export type BuyerMessageRequestDTO = z.infer<typeof buyerMessageRequestSchema>;

/**
 * What the buyer's message was read as.
 *
 * Classified by deterministic code, never by the model — see
 * `classifyBuyerTurn`. The decision about whether a message can move money
 * is not an understanding, and a model that can be talked into it would be
 * a prompt-injection surface attached to a payment path.
 */
export const buyerTurnActionSchema = z.enum(["SEARCH", "REFINE", "COMPARE", "BUY", "AUTHORIZE"]);
export type BuyerTurnActionDTO = z.infer<typeof buyerTurnActionSchema>;

/**
 * A merchant-authored offer the buyer may legitimately be shown.
 *
 * Only offers that reached AUTHORIZED appear: an offer still PROPOSED is
 * something a merchant's agent SUGGESTED, not a price anyone agreed to.
 * Every amount is the merchant's own deterministic calculation, carried
 * verbatim rather than recomputed.
 */
export const buyerVisibleOfferSchema = z.object({
  proposalId: z.string().uuid(),
  productId: z.string().uuid(),
  merchantId: z.string().uuid(),
  kind: z.string(),
  percentageBps: z.number().int().nullable(),
  discountMinor: z.number().int().nullable(),
  baseAmountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  /** Where this came from, in the buyer's terms. Never "we found a deal". */
  provenance: z.string(),
  /**
   * PART 18 — when the merchant's price commitment lapses, ISO-8601.
   *
   * NULL means no window was recorded, which is every offer committed
   * before offers had one. Those still stand, so a consumer must render
   * NULL as "no stated end date", never as "expired" or "expires today".
   */
  validUntil: z.string().nullable(),
  status: z.string(),
});
export type BuyerVisibleOfferDTO = z.infer<typeof buyerVisibleOfferSchema>;

/**
 * A deterministic side-by-side.
 *
 * Rows are catalogue FACTS — price, availability, the attributes the
 * products actually record. The agent does not write prose about which is
 * better here; `differsAcross` names the fields that actually differ, and
 * the buyer draws the conclusion. A comparison that editorialises is a
 * recommendation wearing a table's clothes.
 */
/**
 * How one compared product measures against what the BUYER actually asked
 * for — not against the other products.
 *
 * The comparison used to be blind to the buyer's requirements: it laid
 * catalogue fields side by side and left the reader to remember their own
 * constraints. "Fit" is the missing half, and it is computed from the
 * conversation's own normalized intent, so it can only ever restate
 * requirements the buyer really stated.
 */
export const comparisonFitSchema = z.object({
  /** Requirements this product satisfies, in the buyer's own terms:
   * "under ₹5,000", "size 9". */
  meets: z.array(z.string()),
  /** Requirements it does not. Stated plainly rather than hidden — a
   * near-match presented as a match is how a buyer ends up with the wrong
   * thing. */
  misses: z.array(z.string()),
});

export const buyerComparisonSchema = z.object({
  productIds: z.array(z.string().uuid()),
  /** Names, in the same order as `productIds` — so a buyer reading
   * "Product 1 is lighter" can tell which one that is. */
  productNames: z.array(z.string()),
  rows: z.array(
    z.object({
      label: z.string(),
      /** One entry per compared product, in the same order as
       * `productIds`. Null where that product does not record the field —
       * never filled in with a plausible value. */
      values: z.array(z.string().nullable()),
      /** Whether the products actually differ on this row. */
      differs: z.boolean(),
      /**
       * On a row whose values are ordered and comparable (price), the
       * index of the product with the LOWEST value. Null on rows where
       * "better" is not a fact — colour, category, returns policy.
       *
       * This is the trade-off surface, and it is deliberately narrow: it
       * names which is cheaper, never which is *better*. Ranking a colour
       * would be an opinion wearing a table's clothes.
       */
      lowestIndex: z.number().int().min(0).nullable(),
    }),
  ),
  /** Per compared product, in the same order as `productIds`. */
  fit: z.array(comparisonFitSchema),
  /**
   * Merchant-authorized offers on the compared products, keyed by index
   * into `productIds`. Absent where the product carries none — an empty
   * entry means list price, not "we did not check".
   */
  offers: z.array(
    z.object({
      productIndex: z.number().int().min(0),
      percentageBps: z.number().int().nullable(),
      discountMinor: z.number().int().nullable(),
      currency: z.string().nullable(),
      provenance: z.string(),
    }),
  ),
});
export type BuyerComparisonDTO = z.infer<typeof buyerComparisonSchema>;

/**
 * The outcome of a purchase the buyer asked for in conversation.
 *
 * This is the SAME proposal `POST /buyer/purchase-proposals` creates,
 * through the same service and the same spending-policy evaluation — the
 * conversation is a way to reach it, never a second path around it.
 */
/**
 * What the buyer is being asked to pay for, itemised.
 *
 * A single total is not something a shopper can check. Every field here is
 * an integer in MINOR UNITS — the arithmetic shown is the arithmetic that
 * was performed, and `listTotalMinor - discountMinor === amountMinor`
 * holds exactly, with a test that asserts it. No floats anywhere on this
 * path: a rupee is 100 paise and stays an integer from the catalogue row
 * to the provider's charge.
 */
export const buyerPurchaseOutcomeSchema = z.object({
  proposalId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  /** Named, so the buyer can see WHAT they are buying, not just an id. */
  productName: z.string(),
  variantTitle: z.string(),
  quantity: z.number().int().min(1),
  unitPriceMinor: z.number().int().min(0),
  /** Before any offer. */
  listTotalMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0),
  /** The final total, and the figure the provider is asked to charge. */
  amountMinor: z.number().int(),
  currency: z.string(),
  /** The merchant-authorized offer that produced `discountMinor`, or null
   * when the buyer pays list price. Carries its provenance rather than a
   * marketing line — this is a governance row, not a promotion. */
  appliedOffer: z
    .object({
      proposalId: z.string().uuid(),
      percentageBps: z.number().int().nullable(),
      provenance: z.string(),
    })
    .nullable(),
  /** AUTO_APPROVE / STEP_UP / DECLINE, from the buyer's own policy. */
  outcome: z.string(),
  /** The policy's own words. Never a restatement. */
  explanation: z.string(),
  /** True when the buyer must still explicitly authorize. Money has not
   * moved either way at this point. */
  requiresAuthorization: z.boolean(),
});
export type BuyerPurchaseOutcomeDTO = z.infer<typeof buyerPurchaseOutcomeSchema>;

/**
 * Where the payment actually is, read back from the server.
 *
 * WHY EVERY FIELD HERE IS SERVER-READ
 *
 * The frontend must never conclude that a purchase completed. It cannot
 * observe a charge; only the provider and the server can, and the server
 * only believes the provider after verifying a signature. So this carries
 * the payment's real state and nothing the client could have inferred —
 * a client that simulated completion would be showing a buyer an order
 * that may not exist.
 */
export const buyerCheckoutStateSchema = z.object({
  paymentId: z.string().uuid(),
  /** The payment state machine's own value: CREATED, AUTHORIZED,
   * CAPTURED, FAILED, UNKNOWN. */
  state: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  /** The provider's order reference, needed to open their checkout. Null
   * until one exists. */
  providerOrderId: z.string().nullable(),
  /** The order this payment belongs to, once execution created one. */
  orderId: z.string().uuid().nullable(),
  /** True only when the server has verified a provider-confirmed capture.
   * Never set from a client callback alone. */
  paid: z.boolean(),
});
export type BuyerCheckoutStateDTO = z.infer<typeof buyerCheckoutStateSchema>;

export const buyerAgentResponseSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  status: buyerAgentStatusSchema,
  intent: buyerIntentSchema.nullable(),
  recommendations: z.array(recommendedProductSchema),
  recommendationMode: recommendationModeSchema.nullable(),
  /** The persisted `RecommendationRecord` id for this turn, if one was
   * created — lets a downstream Merchant Agent proposal (PART 04) reuse
   * this exact recommendation outcome (e.g. a NEAR_MATCH recovery offer)
   * instead of re-deriving it. `null` when no recommendation cycle ran
   * (clarification/no-results/AI-unavailable turns). */
  recommendationId: z.string().uuid().nullable(),
  clarification: buyerClarificationSchema.nullable(),
  appliedConstraints: z.array(z.string()),
  candidateCount: z.number().int().min(0),
  aiProviderMode: aiProviderModeSchema,
  dataFreshness: z.string().datetime(),
  traceId: z.string().uuid(),
  trace: z.array(buyerAgentTraceStageSchema),

  // ── PART 09 ────────────────────────────────────────────────────────
  /** How this message was read. Present on every turn, so a buyer can
   * always see whether the agent thought they were searching or buying. */
  turnAction: buyerTurnActionSchema,
  /** Merchant-authored offers on the recommended products. Empty is the
   * normal case and means list price, not "none found yet". */
  offers: z.array(buyerVisibleOfferSchema),
  /** Present only on a COMPARISON_READY turn. */
  comparison: buyerComparisonSchema.nullable(),
  /** Present only on PURCHASE_PROPOSED or PURCHASE_DECLINED. */
  purchase: buyerPurchaseOutcomeSchema.nullable(),
  /**
   * Present only on ACTION_UNRESOLVED — the specific reason a BUY or
   * COMPARE could not be carried out, in the buyer's own terms: "I only
   * have 2 options in front of me, so there is no number 3", "I need at
   * least two options on the table to compare".
   *
   * Mirrors the existing \`clarification.question\` pattern: a server-
   * composed sentence exposed as a typed field, rather than the client
   * re-deriving one from \`status\` alone. \`status\` alone cannot
   * distinguish "wrong ordinal" from "nothing on the table yet" from "too
   * few products to compare" — three different sentences a buyer needs to
   * hear three different things from.
   */
  unresolvedReason: z.string().nullable(),
  /**
   * Present once the buyer has authorized and a payment order exists.
   * Read from the payment row, never inferred by the client.
   */
  checkout: buyerCheckoutStateSchema.nullable(),
});
export type BuyerAgentResponseDTO = z.infer<typeof buyerAgentResponseSchema>;

export const buyerConversationStatusSchema = z.enum([
  "ACTIVE",
  "AWAITING_CLARIFICATION",
  "RECOMMENDATION_READY",
  "CLOSED",
]);

export const buyerMessageRoleSchema = z.enum(["BUYER", "AGENT"]);

export const buyerMessageDTOSchema = z.object({
  id: z.string().uuid(),
  role: buyerMessageRoleSchema,
  content: z.string(),
  createdAt: z.string().datetime(),
});
export type BuyerMessageDTO = z.infer<typeof buyerMessageDTOSchema>;

export const buyerConversationSchema = z.object({
  id: z.string().uuid(),
  status: buyerConversationStatusSchema,
  currentIntent: buyerIntentSchema.nullable(),
  messages: z.array(buyerMessageDTOSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BuyerConversationDTO = z.infer<typeof buyerConversationSchema>;
