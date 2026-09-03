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
  "status" | "recommendations" | "turnAction" | "offers" | "comparison" | "purchase" | "unresolvedReason" | "clarification"
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
      comparison: {
        productIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        rows: [
          { label: "Product", values: ["Meridian Summit Trail", "Meridian Cloud Runner"], differs: true },
          { label: "Price from", values: ["580200", "449900"], differs: true },
          { label: "Sold by", values: ["Meridian Athletics", "Meridian Athletics"], differs: false },
        ],
      },
    };

    renderBubble(response);

    // The regression this pins: before the fix, NOTHING below the
    // narrated sentence rendered for this status — the table simply did
    // not exist in the DOM.
    expect(screen.getByText("Side by side")).toBeInTheDocument();
    expect(screen.getByText("Meridian Summit Trail")).toBeInTheDocument();
    expect(screen.getByText("Meridian Cloud Runner")).toBeInTheDocument();
    // `differs` came from the server and must not be recomputed here —
    // this just checks the row rendered, not that the client re-derived it.
    expect(screen.getByText("Price from")).toBeInTheDocument();
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
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        quantity: 1,
        amountMinor: 580_200,
        currency: "INR",
        outcome: "AUTO_APPROVE",
        explanation: "Within the saved buyer policy; ready for authorization.",
        requiresAuthorization: false,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Priced and proposed")).toBeInTheDocument();
    expect(screen.getByText("Within the saved buyer policy; ready for authorization.")).toBeInTheDocument();
    expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument();
    // The price itself is on screen, not just a generic confirmation.
    expect(screen.getByText(/5,802/)).toBeInTheDocument();
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
      purchase: {
        proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        quantity: 1,
        amountMinor: 1_200_000,
        currency: "INR",
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
        quantity: 1,
        amountMinor: 427_405,
        currency: "INR",
        outcome: "AUTO_APPROVE",
        explanation: "Within the saved buyer policy; ready for authorization.",
        requiresAuthorization: false,
      },
    };

    renderBubble(response);

    expect(screen.getByText("Offers the merchant has authorized")).toBeInTheDocument();
    expect(screen.getByText("5% off")).toBeInTheDocument();
    expect(screen.getByText("Authorized by the merchant's policy engine on 2026-09-01.")).toBeInTheDocument();
  });
});
