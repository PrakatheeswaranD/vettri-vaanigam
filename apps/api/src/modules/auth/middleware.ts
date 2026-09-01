/**
 * Global authentication gate (PART 10 §1). Every `/api/v1/*` route is
 * authenticated by default — a request with no valid session token
 * cannot resolve a `merchantId` at all, and every route's data access is
 * already scoped by whatever `merchantId` it queries with. This is what
 * makes multi-tenant isolation structural rather than a per-route
 * afterthought: a route simply has no way to see another merchant's
 * data, because it never has that merchant's id to query with.
 *
 * A short, explicit allowlist skips this: `/auth/login` (you can't
 * require a session to obtain one), `/health` and `/system/readiness`
 * (liveness/readiness probes, no merchant context), and the Razorpay
 * webhook route (authenticated by HMAC signature verification, not a
 * merchant user session — Razorpay's servers are not a logged-in user).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { resolveSession } from "./session.js";

/**
 * Routes reachable without a merchant session.
 *
 * The Vaanigam gateway intake is here for a structural reason, not
 * convenience: a buyer agent that has never met this merchant cannot hold
 * a merchant session, and requiring one would defeat the premise of being
 * payable by any agent. Its gate is the signed spend mandate plus merchant
 * policy — see `modules/gateway/routes.ts`, which documents the exposure
 * this accepts. The merchant-facing views under the same prefix
 * (/decisions, /metrics) are NOT matched by it and stay authenticated.
 */
const UNAUTHENTICATED_PATH_PREFIXES = [
  "/api/v1/auth/login",
  "/api/v1/health",
  "/api/v1/system/readiness",
  "/api/v1/payments/webhooks/razorpay",
];

/** Matched separately because it is a PATTERN, not a prefix — the merchant
 * slug sits in the middle of the path. */
const UNAUTHENTICATED_PATH_PATTERNS = [
  /^\/api\/v1\/agent-gateway\/[^/]+\/intents(\?.*)?$/,
  /^\/api\/v1\/agent-gateway\/decisions\/[^/]+\/status(\?.*)?$/,
  // Discovery documents are public on purpose — an agent must be able to
  // read the catalogue before it can have a session, and these expose
  // only what the merchant already publishes to human shoppers.
  /^\/api\/v1\/agent-catalog\/[^/]+\/\.well-known\/[a-z-]+\.json(\?.*)?$/,
  // The ACP surface is the protocol's own merchant API. A buyer agent
  // reaches it with ACP credentials and an Allowance, never a merchant
  // session — same reasoning as the gateway intake above.
  /^\/api\/v1\/acp\/[^/]+\//,
  // x402 is an HTTP-native payment protocol: the whole point is that an
  // unauthenticated request gets a 402 and retries with payment.
  /^\/api\/v1\/x402\/[^/]+\//,
];

declare module "fastify" {
  interface FastifyRequest {
    merchantId: string;
    merchantUserId: string;
    merchantUserRole: string;
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function authenticateRequest(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (UNAUTHENTICATED_PATH_PREFIXES.some((p) => request.url.startsWith(p))) return;
  if (UNAUTHENTICATED_PATH_PATTERNS.some((p) => p.test(request.url))) return;

  const token = extractBearerToken(request);
  if (!token) throw AppError.unauthorized("Authentication required.");

  const session = await resolveSession(prisma, token);
  if (!session) throw AppError.unauthorized("Invalid or expired session.");

  request.merchantId = session.merchantId;
  request.merchantUserId = session.merchantUserId;
  request.merchantUserRole = session.role;
  const path = request.url.split("?", 1)[0]!;
  if (path.startsWith("/api/v1/admin/") && session.role !== "PLATFORM_ADMIN") throw AppError.forbidden("Platform administrator access required.");
  if (session.role === "CUSTOMER") {
    const allowed = path.startsWith("/api/v1/buyer/") || path.startsWith("/api/v1/buyer-agent/conversations/") || path.startsWith("/api/v1/marketplace/") || path.startsWith("/api/v1/auth/") || path.startsWith("/api/v1/system/");
    if (!allowed) throw AppError.forbidden("Customer sessions cannot access merchant management APIs.");
  }
}

/** RBAC: only OWNER or APPROVER may decide an approval (PART 10 §1).
 * VIEWER can read every route but can never mutate a governance
 * decision. Call this explicitly in the approve/reject handlers — kept
 * separate from the blanket `authenticateRequest` hook since it's the
 * one place in this codebase role actually matters. */
/**
 * Changing what agents may spend is the most consequential non-financial
 * action in the product: raising a ceiling authorises every future
 * purchase under it. A VIEWER could previously do it, because RBAC was
 * enforced only on approve/reject. OWNER only.
 */
export function requireOwnerRole(request: FastifyRequest): void {
  if (request.merchantUserRole !== "OWNER") {
    throw AppError.forbidden(
      `Role "${request.merchantUserRole}" may not change spending policy — requires OWNER.`,
    );
  }
}

export function requireApprovalRole(request: FastifyRequest): void {
  if (request.merchantUserRole !== "OWNER" && request.merchantUserRole !== "APPROVER") {
    throw AppError.forbidden(`Role "${request.merchantUserRole}" may not decide an approval — requires OWNER or APPROVER.`);
  }
}
