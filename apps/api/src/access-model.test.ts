/**
 * The access model, asserted against the ROUTES THAT ACTUALLY EXIST.
 *
 * The bug this exists to prevent was not a wrong rule — each individual
 * rule read fine. It was that two rules had to agree about which prefixes
 * name the shopper's surface, and one of them was edited without the
 * other. `POST /buyer-agent/messages` then belonged to nobody: not on the
 * customer allowlist, squarely on the merchant denylist. Every test still
 * passed, because the console happened to call a sibling route.
 *
 * So this suite does not check the table against a hand-written list of
 * paths — a hand-written list would have been updated in the same edit
 * that broke it. It walks Fastify's OWN route table and requires that
 * every authenticated route be reachable by at least one role. A route
 * that nobody can call is the specific failure that shipped, and it is
 * now impossible to add one silently.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { authorizePath } from "./modules/auth/middleware.js";

const ROLES = ["OWNER", "APPROVER", "VIEWER", "CUSTOMER", "PLATFORM_ADMIN"] as const;

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/**
 * Every registered route path, with Fastify's `:params` replaced by a
 * concrete-looking segment. The access table matches on prefixes, so the
 * substituted value never matters — only that the path shape is real.
 */
function registeredPaths(): string[] {
  const paths = new Set<string>();
  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const match = /(\/\S*)/.exec(line);
    if (!match) continue;
    const path = match[1]!.replace(/:[A-Za-z0-9_]+/g, "x").replace(/\s+$/, "");
    if (path.startsWith("/api/v1/")) paths.add(path);
  }
  return [...paths];
}

describe("route access model", () => {
  it("registers routes at all (guards against an empty-sweep false pass)", () => {
    expect(registeredPaths().length).toBeGreaterThan(50);
  });

  it("leaves no route that every role is refused", () => {
    const unreachable = registeredPaths().filter((path) =>
      ROLES.every((role) => !authorizePath(path, role).allowed),
    );
    expect(unreachable).toEqual([]);
  });

  it("keeps the shopper surface shopper-only", () => {
    for (const path of ["/api/v1/buyer/messages", "/api/v1/buyer/purchase-proposals", "/api/v1/marketplace/discovery"]) {
      expect(authorizePath(path, "CUSTOMER").allowed).toBe(true);
      expect(authorizePath(path, "OWNER").allowed).toBe(false);
      expect(authorizePath(path, "PLATFORM_ADMIN").allowed).toBe(false);
    }
  });

  it("keeps merchant management away from shoppers", () => {
    for (const path of ["/api/v1/merchant/policy", "/api/v1/catalog/products", "/api/v1/approvals/pending"]) {
      expect(authorizePath(path, "OWNER").allowed).toBe(true);
      expect(authorizePath(path, "CUSTOMER").allowed).toBe(false);
    }
  });

  it("keeps platform administration to platform administrators", () => {
    expect(authorizePath("/api/v1/admin/overview", "PLATFORM_ADMIN").allowed).toBe(true);
    expect(authorizePath("/api/v1/admin/overview", "OWNER").allowed).toBe(false);
    expect(authorizePath("/api/v1/admin/overview", "CUSTOMER").allowed).toBe(false);
  });

  it("shares authentication and system capabilities with everyone", () => {
    for (const role of ROLES) {
      expect(authorizePath("/api/v1/auth/me", role).allowed).toBe(true);
      expect(authorizePath("/api/v1/system/capabilities", role).allowed).toBe(true);
    }
  });

  it("names the surface it refused, so a 403 is actionable", () => {
    const refusal = authorizePath("/api/v1/buyer/messages", "OWNER");
    expect(refusal.allowed).toBe(false);
    if (!refusal.allowed) expect(refusal.message).toContain("customer purchasing");
  });
});
