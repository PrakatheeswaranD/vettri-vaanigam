/**
 * SEARCH → FILTER → RANK → COMPARE → REASON → RECOMMEND, in one thread.
 *
 * WHAT THIS GUARDS
 *
 * The spec gives a worked example, and this suite is that example run
 * against real catalogue rows:
 *
 *     "Show running shoes."   → the strongest matches
 *     "Only under ₹5,000."    → narrowed, WITHOUT losing the category
 *     "Compare 1 and 3."      → exactly those two, not whatever was first
 *
 * The third step is the one that was broken. `classifyBuyerTurn` read no
 * positions at all for a comparison, so "compare 1 and 3" compared the
 * first four candidates — answering a question the buyer had not asked,
 * with a table that looked entirely plausible.
 *
 * The second step is the one most likely to break silently later: a
 * refinement that starts a fresh search instead of merging drops every
 * constraint the buyer already gave, and still returns results. So the
 * assertion is not "it returned something" but "the category survived and
 * the budget was actually enforced".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { buildCustomerTestApp } from "./test-helpers/test-app.js";
import { prisma } from "./db/client.js";

let app: FastifyInstance;

async function say(message: string, conversationId?: string): Promise<BuyerAgentResponseDTO> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/buyer/messages",
    payload: conversationId ? { conversationId, message } : { message },
  });
  expect(res.statusCode, `"${message}" -> ${res.body}`).toBe(200);
  return res.json() as BuyerAgentResponseDTO;
}

/** Cheapest published price, the same figure the comparison ranks on. */
function priceOf(rec: BuyerAgentResponseDTO["recommendations"][number]): number {
  return rec.product.commerce?.priceRange?.minMinor ?? -1;
}

beforeAll(async () => {
  app = await buildCustomerTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("multi-turn refinement keeps what the buyer already said", () => {
  it("narrows by budget without losing the category", async () => {
    const first = await say("Show running shoes.");
    expect(first.status).toBe("RECOMMENDATIONS_READY");
    expect(first.recommendations.length).toBeGreaterThan(0);
    expect(first.appliedConstraints.join(" ")).toContain("Running Shoes");

    const refined = await say("Only under 3600.", first.conversationId);

    // The category survived the refinement. A fresh search would have
    // dropped it, still returned products, and looked fine.
    expect(refined.appliedConstraints.join(" ")).toContain("Running Shoes");
    expect(refined.appliedConstraints.join(" ")).toMatch(/budget/i);

    // And the budget is genuinely enforced, not merely recorded.
    expect(refined.recommendations.length).toBeGreaterThan(0);
    for (const rec of refined.recommendations) {
      expect(priceOf(rec), `${rec.product.identity.name} is over the stated budget`).toBeLessThanOrEqual(360_000);
    }
  });

  it("filters from the whole catalogue, not from the page it already showed", async () => {
    const first = await say("Show running shoes.");
    const refined = await say("Only under 3600.", first.conversationId);

    // The candidate pool is the merchant's real catalogue — 46 active
    // running shoes at the time of writing — not the five that happened
    // to be recommended on the previous turn.
    expect(refined.candidateCount).toBeGreaterThan(refined.recommendations.length);
  });
});

describe("comparing exactly what the buyer named", () => {
  it("compares 1 and 3, not everything on the table", async () => {
    const search = await say("Show running shoes.");
    expect(search.recommendations.length).toBeGreaterThanOrEqual(3);

    const expectedFirst = search.recommendations[0]!.productId;
    const expectedThird = search.recommendations[2]!.productId;

    const compared = await say("Compare 1 and 3.", search.conversationId);
    expect(compared.status).toBe("COMPARISON_READY");

    const table = compared.comparison!;
    // THE REGRESSION THIS PINS. Before the fix this was four products —
    // the buyer asked about two and was answered about four.
    expect(table.productIds).toHaveLength(2);
    expect(table.productIds[0]).toBe(expectedFirst);
    expect(table.productIds[1]).toBe(expectedThird);
  });

  it("keeps the order the buyer named", async () => {
    const search = await say("Show running shoes.");
    if (search.recommendations.length < 3) return;
    const first = search.recommendations[0]!.productId;
    const third = search.recommendations[2]!.productId;

    const compared = await say("Compare 3 and 1.", search.conversationId);
    const table = compared.comparison!;

    // "3 and 1" is not "1 and 3" on screen. A buyer reading "Product 1 is
    // cheaper" needs the columns in the order they asked for.
    expect(table.productIds[0]).toBe(third);
    expect(table.productIds[1]).toBe(first);
  });

  it("still compares everything when the buyer names nothing", async () => {
    const search = await say("Show running shoes.");
    const compared = await say("Compare these.", search.conversationId);

    // "Compare these" means what is on the table, and the caller decides
    // what that is — capped at four so the table stays readable.
    expect(compared.status).toBe("COMPARISON_READY");
    expect(compared.comparison!.productIds.length).toBeGreaterThan(2);
  });

  it("names the compared products so a trade-off can refer to them", async () => {
    const search = await say("Show running shoes.");
    const compared = await say("Compare 1 and 2.", search.conversationId);
    const table = compared.comparison!;

    expect(table.productNames).toHaveLength(table.productIds.length);
    for (const name of table.productNames) expect(name.length).toBeGreaterThan(0);
  });
});

describe("the comparison is grounded, and knows what the buyer asked for", () => {
  it("states fit against the buyer's own stated requirements", async () => {
    const search = await say("Show running shoes.");
    const refined = await say("Only under 5000.", search.conversationId);
    if (refined.recommendations.length < 2) return;

    const compared = await say("Compare 1 and 2.", refined.conversationId);
    const table = compared.comparison!;

    expect(table.fit).toHaveLength(table.productIds.length);
    for (const fit of table.fit) {
      // The requirements named are the ones the buyer actually stated —
      // category and budget — never an inferred one that would make a
      // product look better than it is.
      expect(fit.meets.join(" ")).toContain("Running Shoes");
      expect([...fit.meets, ...fit.misses].join(" ")).toMatch(/5,000|5000/);
    }
  });

  it("ranks only price, and only when the prices actually differ", async () => {
    const search = await say("Show running shoes.");
    const compared = await say("Compare 1 and 2.", search.conversationId);
    const table = compared.comparison!;

    const priceRow = table.rows.find((row) => row.label === "Price from")!;
    const values = priceRow.values.map((v) => Number(v));

    if (priceRow.differs) {
      // `lowestIndex` must point at the genuinely cheapest column.
      const cheapest = values.indexOf(Math.min(...values));
      expect(priceRow.lowestIndex).toBe(cheapest);
    } else {
      // A tie ranks nothing — claiming a winner between equal prices
      // would be inventing a difference.
      expect(priceRow.lowestIndex).toBeNull();
    }

    // Every other row is unranked. "Which colour is better" has no answer
    // the catalogue can supply, and a table that pretended otherwise
    // would be an opinion wearing a table's clothes.
    for (const row of table.rows) {
      if (row.label !== "Price from") expect(row.lowestIndex, row.label).toBeNull();
    }
  });

  it("derives `differs` from the values themselves", async () => {
    const search = await say("Show running shoes.");
    const compared = await say("Compare 1 and 2.", search.conversationId);

    for (const row of compared.comparison!.rows) {
      const distinct = new Set(row.values.map((v) => v ?? " null"));
      expect(row.differs, row.label).toBe(distinct.size > 1);
    }
  });

  it("never exposes model reasoning in the trace", async () => {
    const search = await say("Show running shoes.");
    const compared = await say("Compare 1 and 2.", search.conversationId);

    // The trace is structured stage facts. Chain-of-thought must never be
    // persisted or returned — a stage detail is what happened, not why a
    // model thought it.
    for (const stage of compared.trace) {
      expect(stage.stage).toMatch(/^[A-Z_]+$/);
      expect(stage.detail.toLowerCase()).not.toMatch(/\bi think\b|\blet me\b|\bstep \d|reasoning:/);
    }
  });
});
