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
 * The Vettri Vaanigam gateway intake is here for a structural reason, not
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
    /** Set for CUSTOMER sessions only. See `getBuyerContextId`. */
    customerAccountId: string | null;
  }
}

/**
 * WHO MAY REACH WHAT — one table, read top to bottom, first match wins.
 *
 * This replaced two independent prefix checks that had drifted apart: a
 * CUSTOMER allowlist naming `/buyer-agent/conversations/` and a later
 * merchant-side denylist naming `/buyer-agent/`. Between them they left
 * `POST /buyer-agent/messages` — the Buyer Agent's only chat endpoint —
 * reachable by NOBODY: not on the customer allowlist, squarely on the
 * merchant denylist. Nothing failed loudly, because the console happened
 * to call a sibling route.
 *
 * Two lists that must agree are two lists that will eventually disagree.
 * One table cannot: a surface is either listed for a role or it is not,
 * and adding a route under an existing prefix inherits an answer instead
 * of silently defaulting to "everyone but the people who need it".
 *
 * `SHOPPER` = the person buying. `MERCHANT` = every merchant-side role
 * (OWNER / APPROVER / VIEWER). `PLATFORM_ADMIN` is its own audience.
 */
type Audience = "SHOPPER" | "MERCHANT" | "PLATFORM_ADMIN";

interface AccessRule {
  prefix: string;
  allow: readonly Audience[];
  /** Used verbatim in the 403 so the refusal names the actual boundary. */
  surface: string;
}

const ACCESS_RULES: readonly AccessRule[] = [
  // Shared surfaces first — these are the exceptions to the role split,
  // so they must be matched before the broader prefixes below.
  { prefix: "/api/v1/auth/", allow: ["SHOPPER", "MERCHANT", "PLATFORM_ADMIN"], surface: "authentication" },
  { prefix: "/api/v1/system/", allow: ["SHOPPER", "MERCHANT", "PLATFORM_ADMIN"], surface: "system capabilities" },

  // The shopper's own surface: their buyer agent, their proposals, their
  // policy, and the cross-merchant catalogue they shop from.
  { prefix: "/api/v1/buyer/", allow: ["SHOPPER"], surface: "customer purchasing" },
  { prefix: "/api/v1/marketplace/", allow: ["SHOPPER"], surface: "marketplace shopping" },

  // The platform operator's surface.
  { prefix: "/api/v1/admin/", allow: ["PLATFORM_ADMIN"], surface: "platform administration" },
];

/** Everything not named above is merchant-side management. */
const DEFAULT_AUDIENCES: readonly Audience[] = ["MERCHANT"];

function audienceForRole(role: string): Audience {
  if (role === "CUSTOMER") return "SHOPPER";
  if (role === "PLATFORM_ADMIN") return "PLATFORM_ADMIN";
  return "MERCHANT";
}

const AUDIENCE_LABEL: Record<Audience, string> = {
  SHOPPER: "Customer sessions",
  MERCHANT: "Merchant sessions",
  PLATFORM_ADMIN: "Platform administrator sessions",
};

/** Exported for the access-model test, which asserts every registered
 * route resolves to an audience that can actually reach it. */
export function authorizePath(path: string, role: string): { allowed: true } | { allowed: false; message: string } {
  const audience = audienceForRole(role);
  const rule = ACCESS_RULES.find((candidate) => path.startsWith(candidate.prefix));
  const allowed = rule ? rule.allow : DEFAULT_AUDIENCES;
  if (allowed.includes(audience)) return { allowed: true };
  return {
    allowed: false,
    message: `${AUDIENCE_LABEL[audience]} cannot access ${rule?.surface ?? "merchant management"} APIs.`,
  };
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
  request.customerAccountId = session.customerAccountId;
  const path = request.url.split("?", 1)[0]!;
  const verdict = authorizePath(path, session.role);
  if (!verdict.allowed) throw AppError.forbidden(verdict.message);
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
