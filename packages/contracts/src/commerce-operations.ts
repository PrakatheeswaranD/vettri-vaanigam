import { z } from "zod";
import { currencySchema } from "./common.js";
import { revenueOpportunityTypeSchema } from "./revenue-opportunity.js";

/**
 * 🛍 Commerce — the merchant's operational data and action layer.
 *
 * WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * Commerce answers *what is true right now*: this product's stock and
 * sales, this customer's behaviour, this order's state, this payment's
 * state. Growth answers *what should I do about it*.
 *
 * Those are two questions and they get one answer each. Every view below
 * carries an `opportunities` array, and it is NOT recomputed here — it is
 * the Revenue Opportunity Engine's own output, indexed by subject id.
 * Commerce never detects an opportunity, never scores one, and never
 * estimates a value; it shows which of Growth's already-ranked findings
 * attach to the row you are looking at, so a merchant reading an order
 * does not have to go and find it in a different screen.
 *
 * The rule that keeps this honest: if a number would have to be computed
 * twice to appear in both places, it appears in one place and is
 * REFERENCED from the other. Two screens deriving the same figure
 * independently is how this console previously came to state two
 * different revenues for the same merchant.
 */

/** A Growth finding attached to a Commerce row. A reference, not a copy —
 * every field here is carried verbatim from the engine's output so there
 * is nothing for the two to disagree about. */
export const attachedOpportunitySchema = z.object({
  id: z.string(),
  type: revenueOpportunityTypeSchema,
  title: z.string(),
  /** The engine's own words for why it fired, never a restatement. */
  whyDetected: z.string(),
  actionLabel: z.string(),
  priority: z.number().int().min(0).max(100),
  approvalRequired: z.boolean(),
  policyOutcome: z.enum(["ELIGIBLE", "REQUIRES_APPROVAL", "BLOCKED"]),
  status: z.enum(["DETECTED", "PARTIALLY_ACTIONED", "ACTIONED"]),
  /** The registered agent tool that acts on this, or null when the finding
   * is for a human to read rather than for the agent to work. */
  tool: z.string().nullable(),
});
export type AttachedOpportunityDTO = z.infer<typeof attachedOpportunitySchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * PRODUCTS — catalog + performance + AI-readiness
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * How a product has actually performed.
 *
 * PAID-only, whole-history, and counted in the database rather than over a
 * page. `unitsSold` and `revenueMinor` come from order items on orders in
 * status PAID, so a basket that was abandoned or a payment that failed
 * contributes nothing — the same rule the commerce summary and the Revenue
 * Opportunity Engine already use. A "units sold" that counts unpaid
 * baskets is the kind of plausible wrong number this codebase keeps
 * finding.
 */
export const productPerformanceSchema = z.object({
  unitsSold: z.number().int().min(0),
  revenueMinor: z.number().int().min(0),
  paidOrderCount: z.number().int().min(0),
  lastSoldAt: z.string().nullable(),
  /** Null when the product has never appeared in a paid order — an
   * average over no observations is not invented as zero. */
  averageSellingPriceMinor: z.number().int().min(0).nullable(),
});
export type ProductPerformanceDTO = z.infer<typeof productPerformanceSchema>;

/**
 * The OPERATIONAL OVERLAY for one product — deliberately not a product.
 *
 * Name, category, price, availability and stock already come from
 * `GET /catalog/products`, which browses, filters and paginates the
 * catalogue. Repeating those fields here would put two copies of the same
 * product on one screen, free to disagree the moment one endpoint changes.
 *
 * So this carries ONLY what the catalogue does not: how the product has
 * actually performed, how readable it is to an AI buyer, and which Growth
 * findings attach to it. Joined by `productId` on the client.
 */
export const commerceProductSchema = z.object({
  productId: z.string().uuid(),
  performance: productPerformanceSchema,
  /**
   * The SAME per-product classification `deriveProductReadiness` produces,
   * carried verbatim — not a score invented here to look quantitative. The
   * engine grades three states and names what is missing; putting a 0-100
   * number on top of that would claim a precision the evidence does not
   * support.
   */
  aiReadiness: z.object({
    state: z.enum(["AGENT_READY", "PARTIALLY_READY", "NOT_READY"]),
    /** Missing CRITICAL fields — an AI buyer cannot safely transact. */
    missingCritical: z.array(z.string()),
    /** Missing IMPORTANT fields — transactable, but degraded. */
    missingImportant: z.array(z.string()),
  }),
  opportunities: z.array(attachedOpportunitySchema),
});
export type CommerceProductDTO = z.infer<typeof commerceProductSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * CUSTOMERS — observable behaviour + eligible growth opportunities
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Only what has been observed. There is no predicted lifetime value, no
 * churn probability and no propensity score here, because this build has
 * no basis for one and a confident-looking number without a basis is the
 * thing the whole engine refuses.
 */
export const customerBehaviourSchema = z.object({
  paidOrderCount: z.number().int().min(0),
  orderCount: z.number().int().min(0),
  lifetimeValueMinor: z.number().int().min(0),
  averageOrderValueMinor: z.number().int().min(0).nullable(),
  firstPaidOrderAt: z.string().nullable(),
  lastPaidOrderAt: z.string().nullable(),
  /** Days between their first and most recent paid order. Null for a
   * customer with fewer than two paid orders — a gap needs two points. */
  observedSpanDays: z.number().int().min(0).nullable(),
  /** Median days between consecutive paid orders. Null below two paid
   * orders, for the same reason. */
  medianGapDays: z.number().int().min(0).nullable(),
  /** How many of their paid orders the agent is attributed for. */
  agentAttributedOrderCount: z.number().int().min(0),
});
export type CustomerBehaviourDTO = z.infer<typeof customerBehaviourSchema>;

export const commerceCustomerSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  segment: z.string().nullable(),
  currency: currencySchema,
  behaviour: customerBehaviourSchema,
  opportunities: z.array(attachedOpportunitySchema),
});
export type CommerceCustomerDTO = z.infer<typeof commerceCustomerSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * ORDERS — order state + revenue + payment state + agent attribution
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Who is responsible for this order existing.
 *
 * `source` is the recorded provenance on the order row — never inferred
 * after the fact. `agentAttributed` is true only for the sources the agent
 * actually originates, so "the agent brought this in" is a claim backed by
 * a column rather than by a guess about which orders look agent-shaped.
 */
export const orderAttributionSchema = z.object({
  source: z.string().nullable(),
  label: z.string(),
  agentAttributed: z.boolean(),
  /** The governance row that authorised the agent action behind this
   * order, when there is one. Null for a direct sale. */
  proposalId: z.string().uuid().nullable(),
});
export type OrderAttributionDTO = z.infer<typeof orderAttributionSchema>;

export const commerceOrderSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  createdAt: z.string(),
  totalAmountMinor: z.number().int(),
  currency: currencySchema,
  /** Provider-confirmed captured money on this order, which is NOT the
   * same as its total. An order can be PAID in status while a later
   * refund has moved the captured figure; the console must never present
   * an intended total as received revenue. */
  capturedMinor: z.number().int().min(0),
  customer: z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string().nullable() }).nullable(),
  payment: z
    .object({
      id: z.string().uuid(),
      state: z.string(),
      attemptNumber: z.number().int().min(1),
      failureCategory: z.string().nullable(),
    })
    .nullable(),
  attribution: orderAttributionSchema,
  items: z.array(
    z.object({
      /** An order line references a VARIANT. The product is reachable
       * through it; the snapshots below are what the line actually
       * recorded at the time of sale. */
      variantId: z.string().uuid(),
      productNameSnapshot: z.string(),
      variantTitleSnapshot: z.string(),
      quantity: z.number().int(),
      lineTotalMinor: z.number().int(),
    }),
  ),
  opportunities: z.array(attachedOpportunitySchema),
});
export type CommerceOrderDTO = z.infer<typeof commerceOrderSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * PAYMENTS — payment state + recovery opportunities
 * ══════════════════════════════════════════════════════════════════════ */

export const commercePaymentSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  state: z.string(),
  amountMinor: z.number().int(),
  currency: currencySchema,
  provider: z.string(),
  attemptNumber: z.number().int().min(1),
  createdAt: z.string(),
  failureCode: z.string().nullable(),
  failureCategory: z.string().nullable(),
  customerDebitStatus: z.string().nullable(),
  merchantCreditStatus: z.string().nullable(),
  lastReconciledAt: z.string().nullable(),
  /**
   * Whether the merchant's record of this payment is known to match the
   * provider's.
   *
   * `UNVERIFIED` is its own state and not a flavour of failure: an
   * UNKNOWN payment has an outcome nobody has asked the provider about.
   * It was invisible to the Revenue Opportunity Engine, which filters on
   * `state === "FAILED"`, so these payments were detected by nothing and
   * acted on by nothing — they simply sat.
   */
  verification: z.enum(["VERIFIED", "UNVERIFIED", "NOT_APPLICABLE"]),
  opportunities: z.array(attachedOpportunitySchema),
});
export type CommercePaymentDTO = z.infer<typeof commercePaymentSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * Envelopes
 * ══════════════════════════════════════════════════════════════════════ */

/** Every list view says what window it is, so a bounded page can never be
 * mistaken for the whole history. */
export const commerceWindowSchema = z.object({
  returned: z.number().int().min(0),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
});

export const commerceProductsResponseSchema = z.object({
  products: z.array(commerceProductSchema),
  window: commerceWindowSchema,
  currency: currencySchema,
});
/** Convenience for the console, which joins by id. */
export type CommerceProductOverlayDTO = CommerceProductDTO;
export type CommerceProductsResponseDTO = z.infer<typeof commerceProductsResponseSchema>;

export const commerceCustomersResponseSchema = z.object({
  customers: z.array(commerceCustomerSchema),
  window: commerceWindowSchema,
  currency: currencySchema,
});
export type CommerceCustomersResponseDTO = z.infer<typeof commerceCustomersResponseSchema>;

export const commerceOrdersResponseSchema = z.object({
  orders: z.array(commerceOrderSchema),
  window: commerceWindowSchema,
  currency: currencySchema,
  /** Whole-history counts, computed by the database rather than over the
   * returned page. */
  totals: z.object({
    paidOrderCount: z.number().int().min(0),
    agentAttributedOrderCount: z.number().int().min(0),
    agentAttributedCapturedMinor: z.number().int().min(0),
  }),
});
export type CommerceOrdersResponseDTO = z.infer<typeof commerceOrdersResponseSchema>;

export const commercePaymentsResponseSchema = z.object({
  payments: z.array(commercePaymentSchema),
  window: commerceWindowSchema,
  currency: currencySchema,
  totals: z.object({
    capturedMinor: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    unverifiedCount: z.number().int().min(0),
    recoverableCount: z.number().int().min(0),
  }),
});
export type CommercePaymentsResponseDTO = z.infer<typeof commercePaymentsResponseSchema>;

/* ═══════════════════════════════════════════════════════════════════════
 * AGENT TOOLS — the action layer, declared rather than described
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * How much a tool is allowed to do on its own.
 *
 * AUTOMATIC  Moves no money and writes no merchant-authored fact. It may
 *            only make the merchant's record MORE true — reconciling a
 *            payment against what the provider reports is the whole of
 *            this category. Runs without a proposal because there is
 *            nothing for a policy to weigh.
 *
 * GOVERNED   Everything else. Goes through proposal → policy → approval →
 *            authorization → execute, with no shortcut, whether it was
 *            started by the merchant or by the autonomous cycle.
 *
 * There is deliberately no third class. A tool that "usually doesn't need
 * approval" would be a governed tool with an exception, and the exception
 * is where the money goes missing.
 */
export const agentToolSafetySchema = z.enum(["AUTOMATIC", "GOVERNED"]);
export type AgentToolSafety = z.infer<typeof agentToolSafetySchema>;

export const agentToolSchema = z.object({
  name: z.string(),
  /** What it does, in the merchant's terms. */
  summary: z.string(),
  safety: agentToolSafetySchema,
  /** Which Commerce surface it reads its subjects from, so a merchant can
   * see the data path without reading the code. */
  reads: z.enum(["PRODUCTS", "CUSTOMERS", "ORDERS", "PAYMENTS"]),
  /** What the subject id refers to, e.g. "a payment id". */
  subject: z.string(),
  /** Stated plainly because it is the question a merchant actually has. */
  movesMoney: z.boolean(),
  requiresApproval: z.boolean(),
  /** Opportunity types the autonomous cycle routes to this tool. Empty
   * for a tool only the merchant invokes. */
  handles: z.array(revenueOpportunityTypeSchema),
});
export type AgentToolDTO = z.infer<typeof agentToolSchema>;

export const agentToolsResponseSchema = z.object({
  tools: z.array(agentToolSchema),
});
export type AgentToolsResponseDTO = z.infer<typeof agentToolsResponseSchema>;

export const agentToolInvocationRequestSchema = z.object({
  /** The row to act on: a payment id, a product id. Which one is stated
   * by the tool's own `subject`. */
  subjectId: z.string().uuid(),
});
export type AgentToolInvocationRequestDTO = z.infer<typeof agentToolInvocationRequestSchema>;

export const agentToolInvocationResultSchema = z.object({
  tool: z.string(),
  subjectId: z.string(),
  outcome: z.enum(["EXECUTED", "AWAITING_APPROVAL", "BLOCKED", "REFUSED", "FAILED"]),
  /** Plain sentence a merchant can act on. Never a monetary claim. */
  detail: z.string(),
  proposalId: z.string().uuid().nullable(),
  authorizationId: z.string().uuid().nullable(),
  /** What actually changed, when anything did. Null when the tool
   * refused or failed. */
  changed: z
    .object({
      entity: z.string(),
      id: z.string(),
      from: z.string(),
      to: z.string(),
    })
    .nullable(),
});
export type AgentToolInvocationResultDTO = z.infer<typeof agentToolInvocationResultSchema>;
