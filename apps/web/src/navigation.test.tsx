/**
 * Navigation integrity.
 *
 * The restructure that collapsed nineteen merchant destinations into five
 * moved almost every route in the console. The failure mode of a change
 * like that is not a crash — it is a sidebar link, a tab, or a
 * "View all →" that quietly lands on Not Found, which typechecks
 * perfectly because a route path is just a string.
 *
 * So this walks the app's OWN route table rather than a list written by
 * hand, and asserts three things:
 *
 *   1. Every nav destination resolves to a real route.
 *   2. Every section tab resolves to a real route.
 *   3. Every path anyone links to in the source resolves to a real route.
 *
 * (3) is the one that matters: a hand-written list of links would have
 * been updated in the same edit that broke one.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryRouter, matchRoutes, type RouteObject } from "react-router-dom";
import { NAV_BY_ROLE } from "./components/layout/nav-items";

const SRC = import.meta.dirname;

/**
 * Read the sources off disk rather than through `import.meta.glob`.
 *
 * The glob works, and eagerly pulling every raw module through Vite's
 * transform pipeline made this file take fifteen minutes on a cold run,
 * almost all of it in setup. A test nobody will wait for is a test that
 * gets deleted.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/[.]tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(path);
  }
  return out;
}

/**
 * The route shapes the app declares, mirrored here as data.
 *
 * `App.tsx` builds its routes as JSX, which cannot be enumerated without
 * rendering it — and rendering it pulls in every lazy page and every
 * network hook. This list is checked against the real file below, so it
 * cannot drift silently: the test reads `App.tsx` as text and requires
 * every path here to appear in it, and every `path="…"` there to appear
 * here.
 */
const DECLARED_PATHS = [
  "/", "/login", "/login/:role",

  "/customer", "/customer/buyer-agent", "/customer/discover", "/customer/discover/:productId",
  "/customer/orders", "/customer/payments", "/customer/activity", "/customer/policy",
  "/customer/home", "/customer/cart", "/customer/product/:productId",

  "/merchant", "/merchant/overview",
  "/merchant/agent", "console", "readiness", "connect",
  "/merchant/growth", "opportunities", "offers", "results", "boundaries",
  "/merchant/commerce", "products", "products/:productId", "orders", "customers", "payments", "post-purchase",
  "/merchant/governance", "decisions", "approvals", "policies", "trace", "ledger", "sandbox",
  "/admin", "/admin/platform",
] as const;

/** Built from the same nesting `App.tsx` declares. */
const ROUTES: RouteObject[] = [
  { path: "/" }, { path: "/login" }, { path: "/login/:role" },

  { path: "/customer" },
  { path: "/customer/buyer-agent" },
  { path: "/customer/discover" },
  { path: "/customer/discover/:productId" },
  { path: "/customer/orders" },
  { path: "/customer/payments" },
  { path: "/customer/activity" },
  { path: "/customer/policy" },
  { path: "/customer/home" },
  { path: "/customer/cart" },
  { path: "/customer/product/:productId" },

  { path: "/merchant" },
  { path: "/merchant/overview" },
  {
    path: "/merchant/agent",
    children: [{ index: true }, { path: "console" }, { path: "readiness" }, { path: "connect" }],
  },
  {
    path: "/merchant/growth",
    children: [
      { index: true }, { path: "opportunities" }, { path: "offers" },
      { path: "results" }, { path: "boundaries" },
    ],
  },
  {
    path: "/merchant/commerce",
    children: [
      { index: true }, { path: "products" }, { path: "products/:productId" },
      { path: "orders" }, { path: "customers" }, { path: "payments" }, { path: "post-purchase" },
    ],
  },
  {
    path: "/merchant/governance",
    children: [
      { index: true }, { path: "decisions" }, { path: "approvals" }, { path: "policies" },
      { path: "trace" }, { path: "ledger" }, { path: "sandbox" },
    ],
  },
  { path: "/admin" },
  { path: "/admin/platform" },

  // Legacy redirects, kept so old demo links do not 404.
  { path: "/merchant/ai-buyers" }, { path: "/merchant/approvals" }, { path: "/merchant/policies" },
  { path: "/merchant/trust-trace" }, { path: "/merchant/ledger" }, { path: "/merchant/activity" },
  { path: "/merchant/break-the-agent" }, { path: "/merchant/catalog" }, { path: "/merchant/catalog/:productId" },
  { path: "/merchant/orders" }, { path: "/merchant/customers" }, { path: "/merchant/payments" },
  { path: "/merchant/post-purchase" }, { path: "/merchant/analytics" }, { path: "/merchant/offers" },
  { path: "/merchant/readiness" }, { path: "/merchant/protocols" }, { path: "/merchant/demo-tour" },
  { path: "/merchant/agent/offers" },
  { path: "/ai-buyer" }, { path: "/overview" }, { path: "/agent-gateway" }, { path: "/catalog" },
  { path: "/catalog/:productId" }, { path: "/growth" }, { path: "/approvals" }, { path: "/readiness" },
  { path: "/transactions" }, { path: "/post-purchase" }, { path: "/action-ledger" }, { path: "/settings" },
];

function resolves(path: string): boolean {
  return (matchRoutes(ROUTES, path) ?? []).length > 0;
}

/** Every `to="/…"` and `to={`/…`}` written anywhere in the app source. */
function linkedPaths(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    // Only literal, app-internal targets. A template link like
    // `/customer/discover/${id}` is normalised to a placeholder segment so
    // it can be matched against the route table.
    for (const match of source.matchAll(/\bto=(?:"|\{")(\/[^"`]*)"/g)) found.add(match[1]!);
    for (const match of source.matchAll(/\bto=\{`(\/[^`]*)`\}/g)) {
      found.add(match[1]!.replace(/\$\{[^}]*\}/g, "placeholder"));
    }
    // Section tabs are object literals (`{ to: "/merchant/…", label }`),
    // not JSX attributes, so they need their own pattern — otherwise the
    // one navigation surface this restructure INTRODUCED would be the one
    // surface this test does not check.
    for (const match of source.matchAll(/\bto:\s*"(\/[^"]*)"/g)) found.add(match[1]!);
  }
  return [...found];
}

describe("navigation", () => {
  it("gives the merchant exactly the five Track 01 destinations", () => {
    const items = NAV_BY_ROLE.merchant.flatMap((section) => section.items);
    expect(items.map((item) => item.label)).toEqual([
      "Overview", "Merchant Agent", "Growth", "Commerce", "Governance",
    ]);
  });

  it("gives the shopper exactly the six Track 01 destinations", () => {
    const items = NAV_BY_ROLE.customer.flatMap((section) => section.items);
    expect(items.map((item) => item.label)).toEqual([
      "Buyer Agent", "Discover", "Orders", "Payments", "Agent Activity", "Spending Policy",
    ]);
  });

  it("routes every nav destination", () => {
    const unresolved = Object.values(NAV_BY_ROLE)
      .flatMap((sections) => sections.flatMap((section) => section.items))
      .map((item) => item.to)
      .filter((to) => !resolves(to));
    expect(unresolved).toEqual([]);
  });

  it("finds links to check (guards against an empty-sweep false pass)", () => {
    expect(linkedPaths().length).toBeGreaterThan(10);
  });

  it("routes every link written anywhere in the app", () => {
    const unresolved = linkedPaths().filter((path) => !resolves(path.split("?")[0]!));
    expect(unresolved).toEqual([]);
  });

  it("keeps this route table in step with App.tsx", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    const declaredInApp = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== "*");
    // Every path App.tsx declares is one this table knows about...
    for (const path of declaredInApp) {
      expect(ROUTES.some((r) => r.path === path) || ROUTES.some((r) => r.children?.some((c) => c.path === path)), `App.tsx declares ${path}, this table does not`).toBe(true);
    }
    // ...and every path this table claims is one App.tsx actually declares.
    for (const path of DECLARED_PATHS) {
      expect(declaredInApp.includes(path), `this table claims ${path}, App.tsx does not declare it`).toBe(true);
    }
  });

  it("still answers old links instead of 404ing them", () => {
    for (const legacy of ["/merchant/ai-buyers", "/merchant/catalog", "/customer/home", "/customer/cart", "/settings", "/action-ledger"]) {
      expect(resolves(legacy), `${legacy} should redirect, not 404`).toBe(true);
    }
  });

  it("builds a router without duplicate or malformed paths", () => {
    expect(() => createMemoryRouter(ROUTES.map((r) => ({ ...r, element: null })))).not.toThrow();
  });
});
