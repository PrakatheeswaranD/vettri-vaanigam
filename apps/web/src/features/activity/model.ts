/**
 * Agent Activity read model (Part 11 §28).
 *
 * A pure, presentation-only transformation over ledger rows the backend
 * already produced. It is deliberately NOT a second audit source: it
 * adds no facts, invents no events, and drops nothing silently — an
 * unrecognized `actionType` still surfaces, using its raw name, rather
 * than disappearing from the feed.
 *
 * The Action Ledger remains the deeper technical audit view; this is the
 * merchant-legible narration of the same rows.
 */
import type { AgentActionDTO } from "@razorgrowth/contracts";

export type ActivityActor = "AI" | "SYSTEM" | "POLICY" | "HUMAN" | "PROVIDER";

export type ActivityTone = "positive" | "attention" | "negative" | "neutral";

export interface ActivityEntry {
  id: string;
  workflowId: string;
  /** Merchant-legible headline, e.g. "Cross-sell opportunity created". */
  title: string;
  /** The backend's own `conciseReason` — never rewritten or embellished. */
  detail: string;
  actor: ActivityActor;
  tone: ActivityTone;
  createdAt: string;
  /** True when this row's `actionType` has no friendly mapping yet. */
  unmapped: boolean;
}

interface ActivitySpec {
  title: string;
  actor: ActivityActor;
  tone: ActivityTone;
}

/** Maps the real ledger `actionType` vocabulary to merchant-legible
 * headlines. Keys mirror `trust-trace/model.ts`'s `ACTION_GROUP` so the
 * two views can never describe the same event as different things. */
const ACTIVITY_SPEC: Record<string, ActivitySpec> = {
  BUYER_INTENT_EXTRACTED: { title: "Buyer intent received", actor: "AI", tone: "neutral" },
  PRODUCTS_DISCOVERED: { title: "Catalog searched", actor: "SYSTEM", tone: "neutral" },
  RECOMMENDATION_PROPOSED: { title: "Grounded recommendation produced", actor: "AI", tone: "positive" },

  GROWTH_PROPOSAL_CREATED: { title: "Growth opportunity identified", actor: "AI", tone: "positive" },
  GROWTH_PROPOSAL_VALIDATION_FAILED: { title: "Proposal rejected by validation", actor: "SYSTEM", tone: "negative" },

  POLICY_EVALUATED: { title: "Policy evaluated", actor: "POLICY", tone: "neutral" },
  POLICY_ALLOWED: { title: "Policy allowed the action", actor: "POLICY", tone: "positive" },
  POLICY_DENIED: { title: "Policy denied the action", actor: "POLICY", tone: "negative" },

  APPROVAL_REQUESTED: { title: "Merchant approval required", actor: "POLICY", tone: "attention" },
  APPROVAL_APPROVED: { title: "Merchant approved", actor: "HUMAN", tone: "positive" },
  APPROVAL_REJECTED: { title: "Merchant rejected", actor: "HUMAN", tone: "negative" },

  EXECUTION_AUTHORIZATION_ISSUED: { title: "Execution authorized", actor: "SYSTEM", tone: "positive" },
  EXECUTION_AUTHORIZATION_DENIED: { title: "Authorization denied", actor: "SYSTEM", tone: "negative" },
  EXECUTION_AUTHORIZATION_CONSUMED: { title: "Authorization consumed", actor: "SYSTEM", tone: "neutral" },
  AUTHORIZATION_VALIDATED: { title: "Authorization revalidated", actor: "SYSTEM", tone: "neutral" },

  COMMERCE_EXECUTION_REQUESTED: { title: "Commerce execution requested", actor: "SYSTEM", tone: "neutral" },
  CART_CREATED: { title: "Cart created", actor: "SYSTEM", tone: "neutral" },
  ORDER_CREATED: { title: "Order created", actor: "SYSTEM", tone: "neutral" },
  CHECKOUT_CREATED: { title: "Checkout created", actor: "SYSTEM", tone: "neutral" },
  CHECKOUT_READY_FOR_PAYMENT: { title: "Checkout ready for payment", actor: "SYSTEM", tone: "neutral" },
  AUTHORIZED_OFFER_APPLIED: { title: "Authorized offer applied", actor: "SYSTEM", tone: "positive" },

  PAYMENT_INITIATION_REQUESTED: { title: "Payment initiated", actor: "SYSTEM", tone: "neutral" },
  PAYMENT_RECORD_CREATED: { title: "Payment record created", actor: "SYSTEM", tone: "neutral" },
  PROVIDER_ORDER_CREATED: { title: "Provider order created", actor: "PROVIDER", tone: "neutral" },
  CLIENT_PAYMENT_VERIFICATION_RECEIVED: { title: "Client payment result received", actor: "SYSTEM", tone: "neutral" },
  CLIENT_PAYMENT_SIGNATURE_VERIFIED: { title: "Client signature verified", actor: "PROVIDER", tone: "positive" },
  CLIENT_PAYMENT_SIGNATURE_INVALID: { title: "Client signature invalid — rejected", actor: "PROVIDER", tone: "negative" },
  WEBHOOK_RECEIVED: { title: "Provider webhook received", actor: "PROVIDER", tone: "neutral" },
  WEBHOOK_SIGNATURE_VERIFIED: { title: "Webhook signature verified", actor: "PROVIDER", tone: "positive" },
  PAYMENT_AUTHORIZED: { title: "Payment authorized", actor: "PROVIDER", tone: "positive" },
  PAYMENT_CAPTURED: { title: "Payment captured", actor: "PROVIDER", tone: "positive" },
  PAYMENT_FAILED: { title: "Payment failed", actor: "PROVIDER", tone: "negative" },
  PAYMENT_FINANCIAL_INTEGRITY_ERROR: { title: "Financial integrity error blocked", actor: "SYSTEM", tone: "negative" },
  PAYMENT_STATE_TRANSITION_REJECTED: { title: "Invalid payment transition rejected", actor: "SYSTEM", tone: "negative" },
  PAYMENT_RECONCILED: { title: "Payment reconciled with provider", actor: "PROVIDER", tone: "positive" },

  RECOVERY_ELIGIBILITY_EVALUATED: { title: "Recovery eligibility evaluated", actor: "POLICY", tone: "neutral" },
  RECOVERY_PROPOSAL_CREATED: { title: "Recovery proposed", actor: "AI", tone: "attention" },
  RECOVERY_BLOCKED: { title: "Recovery blocked by limits", actor: "POLICY", tone: "negative" },
  RECOVERY_AUTHORIZATION_CONSUMED: { title: "Recovery authorization consumed", actor: "SYSTEM", tone: "neutral" },
  RECOVERY_ATTEMPT_CREATED: { title: "Bounded retry attempted", actor: "SYSTEM", tone: "attention" },

  // The agent-gateway and buyer-purchase vocabularies. These were writing
  // real, frequent ledger rows — an agent request being declined is one of
  // the most common events this system produces — while this map still
  // only knew the PART 04-08 names, so the merchant console tagged them
  // "unmapped event" in its own audit feed. Surfacing an unknown type is
  // the right fallback; leaving known types to fall through it is not.
  AGENT_INTENT_APPROVED: { title: "Agent request approved", actor: "POLICY", tone: "positive" },
  AGENT_INTENT_DECLINED: { title: "Agent request declined", actor: "POLICY", tone: "negative" },
  AGENT_INTENT_STEPPED_UP: { title: "Agent request escalated for approval", actor: "POLICY", tone: "attention" },
  AGENT_STEP_UP_APPROVED: { title: "Escalated request approved", actor: "HUMAN", tone: "positive" },
  AGENT_CHECKOUT_CREATED: { title: "Agent checkout created", actor: "SYSTEM", tone: "neutral" },
  AGENT_INVENTORY_RESERVATION_RELEASED: { title: "Stock reservation released", actor: "SYSTEM", tone: "neutral" },
  AGENT_EXECUTION_FAILED_SAFE: { title: "Execution failed safely — nothing charged", actor: "SYSTEM", tone: "negative" },

  BUYER_PURCHASE_PROPOSED: { title: "Buyer purchase proposed", actor: "AI", tone: "neutral" },
  BUYER_PURCHASE_AUTHORIZED: { title: "Buyer authorized the purchase", actor: "HUMAN", tone: "positive" },

  CUSTOMER_NEGOTIATION_AUTO_APPLIED: { title: "Earned discount applied", actor: "POLICY", tone: "positive" },
  CUSTOMER_NEGOTIATION_PROPOSED: { title: "Discount request sent for your decision", actor: "POLICY", tone: "attention" },
  CUSTOMER_NEGOTIATION_DECLINED: { title: "Discount request declined", actor: "POLICY", tone: "negative" },

  CAMPAIGN_CREATED: { title: "Campaign created", actor: "HUMAN", tone: "neutral" },
  PROPOSE_OFFER: { title: "Offer proposed", actor: "AI", tone: "positive" },
  EVALUATE_OFFER: { title: "Offer evaluated", actor: "POLICY", tone: "neutral" },
  CREATE_CHECKOUT: { title: "Checkout created", actor: "SYSTEM", tone: "neutral" },
  DISCOVER_PRODUCT: { title: "Product discovered", actor: "SYSTEM", tone: "neutral" },
  PROPOSE_RECOVERY: { title: "Recovery proposed", actor: "AI", tone: "attention" },

  // Catalog, campaign, post-purchase and configuration events. These are
  // real ledger writes too; the feed named none of them.
  AGENT_CATALOG_PUBLISHED: { title: "Agent catalogue published", actor: "SYSTEM", tone: "positive" },
  AGENT_CATALOG_ROLLED_BACK: { title: "Agent catalogue rolled back", actor: "SYSTEM", tone: "attention" },
  READINESS_CALCULATED: { title: "Agentic readiness recalculated", actor: "SYSTEM", tone: "neutral" },
  GROWTH_OPPORTUNITY_SCAN: { title: "Growth opportunities scanned", actor: "AI", tone: "neutral" },
  MERCHANT_POLICY_UPDATED: { title: "Policy updated", actor: "HUMAN", tone: "attention" },
  CATALOG_PRODUCT_CREATED: { title: "Product added to the catalogue", actor: "HUMAN", tone: "positive" },

  AGENT_STEP_UP_AUTHORIZATION_EXPIRED: { title: "Escalated request expired unanswered", actor: "SYSTEM", tone: "attention" },
  DECISION_CREATED: { title: "Gateway decision recorded", actor: "POLICY", tone: "neutral" },
  CUSTOMER_NEGOTIATION_APPROVED: { title: "Discount request approved", actor: "HUMAN", tone: "positive" },
  CUSTOMER_NEGOTIATION_REJECTED: { title: "Discount request rejected", actor: "HUMAN", tone: "negative" },

  CAMPAIGN_ORDER_ATTRIBUTED: { title: "Order attributed to a campaign", actor: "SYSTEM", tone: "neutral" },
  CAMPAIGN_CONVERSION_RECORDED: { title: "Campaign conversion recorded", actor: "SYSTEM", tone: "positive" },
  CAMPAIGN_PAYMENT_CAPTURED_CONVERSION: { title: "Campaign conversion confirmed by capture", actor: "PROVIDER", tone: "positive" },

  CHECKOUT_EXPIRED_INVENTORY_RESTOCKED: { title: "Expired checkout released its stock", actor: "SYSTEM", tone: "neutral" },
  ORDER_FULFILLED: { title: "Order fulfilled", actor: "SYSTEM", tone: "positive" },
  RETURN_REQUESTED: { title: "Return requested", actor: "HUMAN", tone: "attention" },
  PAYMENT_REFUNDED: { title: "Payment refunded", actor: "PROVIDER", tone: "neutral" },
  DISPUTE_OPENED: { title: "Dispute opened", actor: "PROVIDER", tone: "negative" },

  PLATFORM_MERCHANT_ONBOARDED: { title: "Merchant onboarded", actor: "SYSTEM", tone: "positive" },
  PLATFORM_MERCHANT_STATUS_CHANGED: { title: "Merchant status changed", actor: "SYSTEM", tone: "attention" },
};

/** Converts an UNMAPPED action type into something readable rather than
 * hiding it — `PAYMENT_SOMETHING_NEW` → "Payment something new". */
function humanizeActionType(actionType: string): string {
  const words = actionType.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function buildActivityFeed(actions: AgentActionDTO[]): ActivityEntry[] {
  return actions.map((action) => {
    const spec = ACTIVITY_SPEC[action.actionType];
    return {
      id: action.id,
      workflowId: action.workflowId,
      title: spec?.title ?? humanizeActionType(action.actionType),
      detail: action.conciseReason,
      actor: spec?.actor ?? "SYSTEM",
      tone: spec?.tone ?? "neutral",
      createdAt: action.createdAt,
      unmapped: spec === undefined,
    };
  });
}
