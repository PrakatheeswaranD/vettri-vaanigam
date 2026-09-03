/**
 * The default "Buyer view" bubble, rendered against real response shapes.
 *
 * WHY THIS EXISTS
 *
 * `AgentTurnResult` — the comparison table, the offers, the purchase card
 * — was built, typechecked, and rendered correctly in the *trace* view.
 * It was never wired into `AgentBubble`, the component the default view
 * actually shows. Nobody navigates to the trace view to shop, so a buyer
 * who said "buy the second one" saw "Found 0 that fit." and nothing else.
 *
 * That gap was invisible to the API test suite, because none of those
 * tests render a page — they assert on the JSON `BuyerAgentResponseDTO`,
 * which was correct the whole time. Only a component test that actually
 * mounts `AgentBubble` and reads the DOM can catch "the data was right
 * and nothing displayed it", which is exactly the failure mode this file
 * exists to make impossible again.
 *
 * These are not browser/visual tests — no login, no dev server, just
 * `@testing-library/react` rendering the real component tree with real
 * response payloads and asserting on what a buyer would actually see.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BuyerAgentResponseDTO } from "@razorgrowth/contracts";
import { AgentBubble } from "./ChatTurn";

const BASE: Omit<
  BuyerAgentResponseDTO,
  | "status"
  | "recommendations"
  | "turnAction"
  | "offers"
  | "comparison"
  | "purchase"
  | "unresolvedReason"
  | "clarification"
  | "checkout"
> = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  messageId: "22222222-2222-4222-8222-222222222222",
  intent: null,
  recommendationMode: null,
  recommendationId: null,
  appliedConstraints: [],
  candidateCount: 0,
  aiProviderMode: "DEMO_RULE_BASED",
  dataFreshness: "2026-09-03T10:00:00.000Z",
  traceId: "33333333-3333-4333-8333-333333333333",
  trace: [],
};

function renderBubble(response: BuyerAgentResponseDTO) {
  return render(
    <MemoryRouter>
      <AgentBubble buyerMessage="buy the second one" response={response} />
    </MemoryRouter>,
  );
}

describe("AgentBubble — the default view a buyer actually sees", () => {
  it("renders the comparison table on a COMPARISON_READY turn", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "COMPARISON_READY",
      recommendations: [],
      turnAction: "COMPARE",
      offers: [],
      purchase: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      comparison: {
        productIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        productNames: ["Meridian Summit Trail", "Meridian Cloud Runner"],
        rows: [
          { label: "Product", values: ["Meridian Summit Trail", "Meridian Cloud Runner"], differs: true, lowestIndex: null },
          // The cheaper of the two is index 1 — the only ranked row.
          { label: "Price from", values: ["580200", "449900"], differs: true, lowestIndex: 1 },
          { label: "Sold by", values: ["Meridian Athletics", "Meridian Athletics"], differs: false, lowestIndex: null },
        ],
        fit: [
          { meets: ["Running Shoes"], misses: ["under ₹5,000"] },
          { meets: ["Running Shoes", "under ₹5,000"], misses: [] },
        ],
        offers: [],
      },
    };

    renderBubble(response);

    // The regression this pins: before the fix, NOTHING below the
    // narrated sentence rendered for this status — the table simply did
    // not exist in the DOM.
    expect(screen.getByText("Side by side")).toBeInTheDocument();
    // Each name appears twice by design: once in the table row, once as
    // the heading of its fit card. Presence is the claim, not uniqueness.
    expect(screen.getAllByText("Meridian Summit Trail").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Meridian Cloud Runner").length).toBeGreaterThan(0);
    // `differs` came from the server and must not be recomputed here —
    // this just checks the row rendered, not that the client re-derived it.
    expect(screen.getByText("Price from")).toBeInTheDocument();

    // PART 11 — the trade-off marker, on the one row where "lower" is a
    // fact rather than a preference.
    expect(screen.getByText("lowest")).toBeInTheDocument();

    // Fit against the buyer's OWN stated requirements, misses included.
    // A near-match presented as a match is how a buyer ends up with the
    // wrong thing, so the miss has to be on screen.
    expect(screen.getAllByText("Running Shoes").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/under ₹5,000/).length).toBeGreaterThan(0);
  });

  it("marks the cheaper option once, not every column", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "COMPARISON_READY",
      recommendations: [],
      turnAction: "COMPARE",
      offers: [],
      purchase: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      comparison: {
        productIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        productNames: ["Cheaper one", "Dearer one"],
        rows: [
          { label: "Price from", values: ["100000", "200000"], differs: true, lowestIndex: 0 },
          // A tie ranks nothing — claiming a winner between equal values
          // would be inventing a difference.
          { label: "Category", values: ["Running Shoes", "Running Shoes"], differs: false, lowestIndex: null },
        ],
        fit: [
          { meets: [], misses: [] },
          { meets: [], misses: [] },
        ],
        offers: [],
      },
    };

    renderBubble(response);
    expect(screen.getAllByText("lowest")).toHaveLength(1);
  });

  it("renders the priced purchase card and states nothing was charged", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "PURCHASE_PROPOSED",
      recommendations: [],
      turnAction: "BUY",
      offers: [],
      comparison: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        productName: "Meridian Summit Trail",
        variantTitle: "UK9 (Black)",
        quantity: 1,
        unitPriceMinor: 580_200,
        listTotalMinor: 580_200,
        discountMinor: 0,
        amountMinor: 580_200,
        currency: "INR",
        appliedOffer: null,
        outcome: "AUTO_APPROVE",
        explanation: "Within the saved buyer policy; ready for authorization.",
        requiresAuthorization: false,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Priced and proposed")).toBeInTheDocument();
    expect(screen.getByText("Within the saved buyer policy; ready for authorization.")).toBeInTheDocument();
    expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument();
    // The price is on screen. It appears more than once by design — at
    // quantity 1 the unit-price row and the total row are the same figure
    // — so this asserts presence, not uniqueness.
    expect(screen.getAllByText(/5,802/).length).toBeGreaterThan(0);
  });

  it("renders the decline, with the policy's own words, never softened", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "PURCHASE_DECLINED",
      recommendations: [],
      turnAction: "BUY",
      offers: [],
      comparison: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        productName: "Meridian Summit Trail",
        variantTitle: "UK9 (Black)",
        quantity: 1,
        unitPriceMinor: 1_200_000,
        listTotalMinor: 1_200_000,
        discountMinor: 0,
        amountMinor: 1_200_000,
        currency: "INR",
        appliedOffer: null,
        outcome: "DECLINE",
        explanation: "DAILY_LIMIT_EXCEEDED",
        requiresAuthorization: true,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Your spending policy declined this")).toBeInTheDocument();
    expect(screen.getByText("DAILY_LIMIT_EXCEEDED")).toBeInTheDocument();
    // The reassurance line is only for a proposal that stands, never for
    // one that was refused.
    expect(screen.queryByText(/nothing has been charged/i)).not.toBeInTheDocument();
  });

  it("narrates the server's own reason on an unresolved action, not a generic fallback", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "ACTION_UNRESOLVED",
      recommendations: [],
      turnAction: "BUY",
      offers: [],
      comparison: null,
      purchase: null,
      clarification: null,
      checkout: null,
      unresolvedReason: "I only have 2 options in front of me, so there is no number 3. Say which of them you meant.",
    };

    renderBubble(response);

    // The regression this pins: before the fix, this status fell through
    // to `Found ${recommendations.length} that fit.` — and that array is
    // always empty here, so the buyer saw "Found 0 that fit."
    expect(screen.getByText(/no number 3/)).toBeInTheDocument();
    expect(screen.queryByText(/found 0/i)).not.toBeInTheDocument();
  });

  it("still narrates a plain search correctly — the original path is unchanged", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "RECOMMENDATIONS_READY",
      recommendations: [],
      turnAction: "SEARCH",
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
    };

    renderBubble(response);

    expect(screen.getByText("Found 0 that fit.")).toBeInTheDocument();
  });

  it("shows the merchant-authorized offer alongside a purchase card", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "PURCHASE_PROPOSED",
      recommendations: [],
      turnAction: "BUY",
      comparison: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      offers: [
        {
          proposalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          merchantId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          kind: "PERCENTAGE",
          percentageBps: 500,
          discountMinor: 22_495,
          baseAmountMinor: 449_900,
          currency: "INR",
          provenance: "Authorized by the merchant's policy engine on 2026-09-01.",
          status: "AUTHORIZED",
        },
      ],
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        productName: "Meridian Pulse Runner",
        variantTitle: "UK7 (Blue)",
        quantity: 1,
        unitPriceMinor: 449_900,
        listTotalMinor: 449_900,
        discountMinor: 22_495,
        amountMinor: 427_405,
        currency: "INR",
        appliedOffer: {
          proposalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          percentageBps: 500,
          provenance: "Authorized by the merchant's policy engine on 2026-09-01.",
        },
        outcome: "AUTO_APPROVE",
        explanation: "Within the saved buyer policy; ready for authorization.",
        requiresAuthorization: false,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Offers the merchant has authorized")).toBeInTheDocument();
    expect(screen.getByText("5% off")).toBeInTheDocument();
    // Shown on the purchase card AND in the offers list. Both are the
    // right place for it, so presence is what matters.
    expect(screen.getAllByText("Authorized by the merchant's policy engine on 2026-09-01.").length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * PART 10 — the itemised breakdown, and a checkout state that never
 * claims a purchase completed.
 * ══════════════════════════════════════════════════════════════════════ */

describe("AgentBubble — the money a buyer is being asked for", () => {
  it("shows the arithmetic, not just a total", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "PURCHASE_PROPOSED",
      recommendations: [],
      turnAction: "BUY",
      offers: [],
      comparison: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        productName: "Meridian Pulse Runner",
        variantTitle: "UK7 (Blue)",
        quantity: 1,
        unitPriceMinor: 450_000,
        listTotalMinor: 450_000,
        discountMinor: 22_500,
        amountMinor: 427_500,
        currency: "INR",
        appliedOffer: {
          proposalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          percentageBps: 500,
          provenance: "Authorized by the merchant's policy engine on 2026-09-03.",
        },
        outcome: "AUTO_APPROVE",
        explanation: "Within the saved buyer policy; ready for authorization.",
        requiresAuthorization: false,
      },
    };

    renderBubble(response);

    // WHAT is being bought, not just how much.
    expect(screen.getByText("Meridian Pulse Runner")).toBeInTheDocument();
    expect(screen.getByText(/UK7 \(Blue\)/)).toBeInTheDocument();

    // The three figures a buyer can check against each other:
    // ₹4,500 list − ₹225 offer = ₹4,275 total.
    // 4,500 appears twice by design: the unit price at quantity 1, and
    // the list subtotal. The claim being tested is that all three figures
    // are on screen and agree — not that each appears exactly once.
    expect(screen.getAllByText(/4,500/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/225/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4,275/).length).toBeGreaterThan(0);

    // The discount is attributed, not presented as a deal we found.
    expect(screen.getByText(/Merchant offer, 5% off/)).toBeInTheDocument();
    expect(screen.getByText(/Authorized by the merchant's policy engine/)).toBeInTheDocument();
  });

  it("omits the discount row entirely when the buyer pays list price", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "PURCHASE_PROPOSED",
      recommendations: [],
      turnAction: "BUY",
      offers: [],
      comparison: null,
      unresolvedReason: null,
      clarification: null,
      checkout: null,
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        productName: "Meridian Summit Trail",
        variantTitle: "UK9 (Black)",
        quantity: 1,
        unitPriceMinor: 580_200,
        listTotalMinor: 580_200,
        discountMinor: 0,
        amountMinor: 580_200,
        currency: "INR",
        appliedOffer: null,
        outcome: "AUTO_APPROVE",
        explanation: "Within the saved buyer policy; ready for authorization.",
        requiresAuthorization: false,
      },
    };

    renderBubble(response);

    // A "−₹0" row would imply an offer that does not exist.
    expect(screen.queryByText(/Merchant offer/)).not.toBeInTheDocument();
  });
});

describe("AgentBubble — checkout never claims money moved", () => {
  it("says the payment order is ready and explicitly not charged", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "CHECKOUT_READY",
      recommendations: [],
      turnAction: "AUTHORIZE",
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      clarification: null,
      checkout: {
        paymentId: "99999999-9999-4999-8999-999999999999",
        state: "CREATED",
        amountMinor: 427_500,
        currency: "INR",
        providerOrderId: "order_TestABC123",
        orderId: "88888888-8888-4888-8888-888888888888",
        paid: false,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Ready for payment")).toBeInTheDocument();
    expect(screen.getByText("CREATED")).toBeInTheDocument();
    expect(screen.getByText("order_TestABC123")).toBeInTheDocument();

    // THE ASSERTION THAT MATTERS MOST ON THIS SCREEN. A payment order is
    // not a payment, and the UI must not let a buyer read it as one.
    expect(screen.getByText(/still not charged/i)).toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText(/provider confirmed this capture/i)).not.toBeInTheDocument();
  });

  it("only says confirmed when the server reports a verified capture", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "CHECKOUT_READY",
      recommendations: [],
      turnAction: "AUTHORIZE",
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      clarification: null,
      checkout: {
        paymentId: "99999999-9999-4999-8999-999999999999",
        state: "CAPTURED",
        amountMinor: 427_500,
        currency: "INR",
        providerOrderId: "order_TestABC123",
        orderId: "88888888-8888-4888-8888-888888888888",
        paid: true,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
    expect(screen.getByText(/provider confirmed this capture/i)).toBeInTheDocument();
    expect(screen.queryByText(/still not charged/i)).not.toBeInTheDocument();
  });

  it("narrates an authorized turn without ever saying purchased", () => {
    const response: BuyerAgentResponseDTO = {
      ...BASE,
      status: "CHECKOUT_READY",
      recommendations: [],
      turnAction: "AUTHORIZE",
      offers: [],
      comparison: null,
      purchase: null,
      unresolvedReason: null,
      clarification: null,
      checkout: {
        paymentId: "99999999-9999-4999-8999-999999999999",
        state: "CREATED",
        amountMinor: 427_500,
        currency: "INR",
        providerOrderId: "order_TestABC123",
        orderId: null,
        paid: false,
      },
    };

    renderBubble(response);

    expect(screen.getByText(/nothing has been charged yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/purchased|order placed|payment complete/i)).not.toBeInTheDocument();
  });
});
