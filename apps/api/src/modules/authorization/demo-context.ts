/**
 * Authorization foundation (PART 00 §36, §55; PART 01 §55; PART 10 §1).
 *
 * PART 01–09 resolved a single hardcoded demo merchant server-side by a
 * fixed slug, since no authentication existed yet. PART 10 replaces that
 * with real authentication: every request now carries a `merchantId`
 * decorated onto it by `auth/middleware.ts`'s global `authenticateRequest`
 * hook, resolved from a real, password-verified session — never a value
 * the client sends directly, and never a value any route chooses for
 * itself. A route simply has no way to query another merchant's data,
 * because it never has that merchant's id in the first place.
 */
import type { FastifyRequest } from "fastify";
import { AppError } from "../../http/errors.js";

export const DEMO_MERCHANT_SLUG = "meridian-athletics";

/**
 * Reads the merchant id the auth middleware already resolved for this
 * request. Throws if called on a request that somehow reached a route
 * handler without authentication having run first — this should be
 * structurally impossible given the global hook in `app.ts`, so this is
 * a defensive invariant check, not an expected runtime path.
 */
export function getAuthenticatedMerchantId(request: FastifyRequest): string {
  if (!request.merchantId) {
    throw new AppError("INTERNAL_ERROR", "Request reached a route handler without authentication middleware having run.");
  }
  return request.merchantId;
}

/**
 * The SHOPPER's own account id — the value customer-side routes partition
 * their data by (`BuyerSpendingPolicy`, `BuyerConversation`, and
 * `DecisionRecord.protocolActorRef`).
 *
 * WHAT THIS USED TO RETURN, AND WHY IT NO LONGER DOES
 *
 * It returned `request.merchantId`. A shopper was modelled as a
 * `MerchantUser` with `role: CUSTOMER` inside a synthetic merchant, so
 * their "merchant id" was not a seller at all — it was a buyer partition
 * key stored in the merchant column. One value, two meanings, told apart
 * only by which route you happened to be reading. That ambiguity is how
 * the Buyer Agent's chat endpoint ended up reachable by nobody, and how
 * the AI Buyer Readiness score ended up counting a seller's conversations
 * on a table keyed by shoppers.
 *
 * `CustomerAccount` is now a real table and this returns a real customer
 * id. The account keeps the id of the synthetic merchant it replaced, so
 * every historical `protocolActorRef` still resolves to the same shopper.
 *
 * Throws for a non-CUSTOMER session rather than falling back to the
 * merchant id: a merchant session reaching a `/buyer/*` handler is a hole
 * in the access model, and quietly handing it a usable partition key is
 * how such a hole stays invisible.
 */
export function getBuyerContextId(request: FastifyRequest): string {
  if (!request.merchantUserId) {
    throw new AppError("INTERNAL_ERROR", "Request reached a route handler without authentication middleware having run.");
  }
  if (!request.customerAccountId) {
    throw new AppError("INTERNAL_ERROR", "A customer surface was reached by a session that has no customer account.");
  }
  return request.customerAccountId;
}
