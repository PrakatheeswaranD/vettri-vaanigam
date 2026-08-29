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
