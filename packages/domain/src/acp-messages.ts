/**
 * Vaanigam decisions expressed in ACP's own vocabulary.
 *
 * WHY THIS EXISTS
 *
 * A Decision Record's `explanation` reaches the MERCHANT's dashboard. It
 * does not reach the agent that made the call, and an agent told only
 * "declined" cannot correct itself — it retries, or it gives up on a sale
 * that a human would have approved in ten seconds.
 *
 * ACP already has the channel for this: `CheckoutSessionBase.messages`, an
 * array of `MessageInfo | MessageWarning | MessageError`. `MessageError`
 * carries `approval_required` and `intervention_required` codes, which is
 * precisely the step-up gate this system is built around. The escalation
 * is not a workaround bolted onto the protocol; it is a case the protocol
 * anticipated.
 *
 * WHERE THE LINE IS DRAWN — AND WHY IT MATTERS
 *
 * `code` uses ONLY the two ACP enum values above. Vaanigam has fifteen or
 * so reason codes and it would be easy to put `MANDATE_NONCE_REPLAYED`
 * there; that would be inventing an extension inside someone else's enum
 * and calling it compliance. An ACP client switching on `code` would hit a
 * value its own types do not contain.
 *
 * So the protocol's field carries the protocol's vocabulary, the specific
 * reason travels in `content` where free text belongs, and the machine-
 * readable Vaanigam code stays in our own `vaanigam` namespace alongside.
 * A client that speaks only ACP gets something valid; a client that also
 * speaks Vaanigam gets everything.
 *
 * Pure: no database, no clock, no I/O.
 */

/** ACP `MessageError.code`. Deliberately only the values ACP defines. */
export type AcpMessageErrorCode = "approval_required" | "intervention_required";

export type AcpMessageType = "info" | "warning" | "error";

export interface AcpMessage {
  type: AcpMessageType;
  /** Present on `error` messages only. */
  code?: AcpMessageErrorCode;
  content_type: "plain";
  content: string;
}

export interface DecisionForMessages {
  outcome: "AUTO_APPROVE" | "STEP_UP" | "DECLINE";
  reasonCode: string;
  /** The plain-English sentence the gate produced. */
  explanation: string;
  /** Where the human approves, when the flow produced one. */
  stepUpUrl?: string | null;
}

/**
 * Reasons a caller can fix by changing its next request.
 *
 * These get `intervention_required`: something must change before a retry
 * has any chance, and the agent is the party that can change it. Contrast
 * with the ceiling cases, where the request was fine and a human simply
 * has to say yes — nothing the agent does differently would help.
 */
const CALLER_FIXABLE = new Set([
  "AMOUNT_MISMATCH",
  "UNRESOLVABLE_ITEMS",
  "EMPTY_INTENT",
  "CURRENCY_UNSUPPORTED",
  "MANDATE_MISSING",
  "MANDATE_MALFORMED",
  "MANDATE_EXPIRED",
  "MANDATE_NOT_YET_VALID",
  "MANDATE_NONCE_REPLAYED",
  "MANDATE_SIGNATURE_INVALID",
  "MANDATE_KEY_NOT_REGISTERED",
  "MANDATE_KEY_MISMATCH",
  "MANDATE_AGENT_MISMATCH",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_CURRENCY_MISMATCH",
  "MANDATE_MERCHANT_SCOPE_MISMATCH",
  "ALLOWANCE_INVALID",
  "ALLOWANCE_UNAUTHENTICATED",
  "PROTOCOL_UNSUPPORTED",
  "VELOCITY_LIMIT_EXCEEDED",
]);

/**
 * Guidance an agent can act on, per reason.
 *
 * Kept separate from the merchant-facing `explanation`, which is written
 * for a shop owner reading a dashboard. The two audiences want different
 * sentences, and collapsing them produces text that serves neither.
 */
const AGENT_GUIDANCE: Record<string, string> = {
  AMOUNT_MISMATCH: "Re-read the merchant's catalogue and resubmit with the price it publishes. The merchant's price is authoritative.",
  UNRESOLVABLE_ITEMS: "One or more item ids are not sellable SKUs for this merchant. Refresh the catalogue before retrying.",
  MANDATE_MISSING: "Attach a signed spend mandate. This merchant does not accept unauthorised agent purchases.",
  MANDATE_EXPIRED: "The mandate's own expiry has passed. Obtain a fresh mandate from the buyer; a signature does not outlive its terms.",
  MANDATE_NOT_YET_VALID: "This mandate is not valid yet. Check the notBefore time and the clock on your side.",
  MANDATE_NONCE_REPLAYED: "This mandate has already been spent. Every purchase needs its own mandate with its own nonce.",
  MANDATE_SIGNATURE_INVALID: "The signature does not verify against the terms presented. Sign the exact payload you send.",
  MANDATE_KEY_NOT_REGISTERED: "This merchant holds no signing key for your agent. Complete key enrolment before transacting.",
  MANDATE_KEY_MISMATCH: "The mandate was signed by a key this merchant has not registered for you. Rotate keys through enrolment, not in a request.",
  MANDATE_AMOUNT_EXCEEDED: "The basket costs more than the mandate authorises. Obtain a mandate covering the merchant's price for this basket.",
  MANDATE_MERCHANT_SCOPE_MISMATCH: "This mandate was issued for a different merchant. Mandates are not portable between merchants.",
  MANDATE_AGENT_MISMATCH: "This mandate was issued to a different agent id.",
  CATEGORY_BLOCKED: "This merchant does not permit autonomous agent purchases in this category at any value.",
  VELOCITY_LIMIT_EXCEEDED: "Slow down. This merchant rate-limits purchase attempts per agent per hour.",
  CURRENCY_UNSUPPORTED: "This merchant does not sell in the currency requested, and will not invent an exchange rate.",
  PROTOCOL_UNSUPPORTED: "The request did not identify itself as a protocol this gateway reads. Send ACP, AP2 or x402.",
  ALLOWANCE_UNAUTHENTICATED: "An unsigned allowance is only accepted on the authenticated ACP surface.",
  UNKNOWN_AGENT_CEILING_EXCEEDED: "Nothing is wrong with this request. It is above the merchant's automatic limit for agents it has not sold to before, so a human is deciding.",
  KNOWN_AGENT_CEILING_EXCEEDED: "Nothing is wrong with this request. It is above the merchant's automatic limit, so a human is deciding.",
};

/**
 * Builds the ACP `messages` array for one decision.
 *
 * An approval returns an empty array rather than a cheerful info message:
 * `messages` is where a client looks for things needing attention, and
 * filling it on the happy path trains integrators to ignore it.
 */
export function buildAcpMessages(decision: DecisionForMessages): AcpMessage[] {
  if (decision.outcome === "AUTO_APPROVE") return [];

  const guidance = AGENT_GUIDANCE[decision.reasonCode];

  if (decision.outcome === "STEP_UP") {
    const messages: AcpMessage[] = [
      {
        type: "error",
        // The protocol's own word for this exact situation.
        code: "approval_required",
        content_type: "plain",
        content: guidance
          ? `${decision.explanation} ${guidance}`
          : decision.explanation,
      },
    ];

    if (decision.stepUpUrl) {
      messages.push({
        type: "info",
        content_type: "plain",
        content: `A payment link has been issued for the approver: ${decision.stepUpUrl}`,
      });
    }

    messages.push({
      type: "info",
      content_type: "plain",
      content:
        "This is not a refusal. Poll the session, or the status token on the Vaanigam decision, until a human resolves it.",
    });

    return messages;
  }

  return [
    {
      type: "error",
      code: CALLER_FIXABLE.has(decision.reasonCode) ? "intervention_required" : "approval_required",
      content_type: "plain",
      content: guidance ? `${decision.explanation} ${guidance}` : decision.explanation,
    },
  ];
}

/** True when a decision should surface at least one message to the agent. */
export function decisionNeedsAcpMessages(outcome: DecisionForMessages["outcome"]): boolean {
  return outcome !== "AUTO_APPROVE";
}
