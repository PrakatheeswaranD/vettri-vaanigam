/**
 * The Overview, rendered against real API payload shapes.
 *
 * The last link in the chain the rest of this work verifies. The API tests
 * prove the numbers are reproducible from Prisma; this proves the page
 * puts them on screen, in the right stage, under the right classification.
 *
 * WHAT THESE TESTS ARE ACTUALLY GUARDING
 *
 * Not "does it render". The specific way a revenue dashboard goes wrong is
 * that a projection gets printed next to a confirmed figure in the same
 * typeface, or several classes get quietly added into one impressive
 * total. Both look fine in a screenshot and both are lies. So the
 * assertions below pin the separations, not the layout: an ESTIMATED
 * figure is labelled estimated, a VERIFIED one says the provider confirmed
 * it, and no element on the page equals the sum of the classes.
 *
 * `fetch` is stubbed rather than the hooks, so the page exercises its real
 * query layer and the real payload shapes the server returns.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import OverviewPage from "./OverviewPage";

const CURRENCY = "INR" as const;

const REPORT = {
  generatedAt: "2026-09-02T10:00:00.000Z",
  observed: {
    currency: CURRENCY,
    capturedRevenueMinor: 8_959_900,
    averageOrderValueMinor: 995_544,
    paidOrderCount: 9,
    ordersWithPaymentAttempt: 14,
    failedPaymentCount: 3,
    recoveredPaymentCount: 1,
    customerCount: 8,
    repeatCustomerCount: 2,
    agentVisibleProductCount: 200,
    transactableProductCount: 181,
  },
  totals: {
    currency: CURRENCY,
    opportunityCount: 4,
    blockedCount: 1,
    totalAtRiskMinor: 1_240_000,
    totalAddressableMinor: 3_500_000,
    totalExpectedIncrementalMinor: 420_000,
    withheldEstimateCount: 2,
  },
  growthScore: {
    score: 61,
    components: [{ key: "capture", label: "Payment capture", earned: 21, max: 30, evidence: "9 of 14 attempts captured.", toImprove: "Recover the 3 failed payments." }],
  },
  aiBuyerScore: {
    score: 74,
    components: [{ key: "catalogue", label: "Catalogue depth", earned: 32, max: 40, evidence: "181 of 200 products transactable.", toImprove: null }],
  },
  opportunities: [
    {
      id: "opp-recovery-1",
      type: "FAILED_PAYMENT_RECOVERY",
      title: "Recover 3 failed payments",
      whyDetected: "Three payments failed on a retryable provider error in the last 14 days.",
      proposedAction: "PROPOSE_RECOVERY",
      actionLabel: "Start a bounded recovery",
      expectedEffect: {
        atRiskValue: { amountMinor: 1_240_000, currency: CURRENCY },
        addressableValue: { amountMinor: 1_240_000, currency: CURRENCY },
        expectedIncrementalValue: { amountMinor: 420_000, currency: CURRENCY },
        basis: "OBSERVED_HISTORY",
        summary: "Your own recovery rate is 34%.",
      },
      evidence: [{ label: "Failed payments", detail: "3 in the window" }],
      risk: "A retry on an already-debited card could duplicate a charge.",
      policy: { outcome: "ELIGIBLE", detail: "Within your recovery ceiling." },
      effort: "AGENT_AUTOMATIC",
      score: { total: 88, valueScore: 90, confidenceScore: 80, effortScore: 95, urgencyScore: 85 },
      subjectIds: ["pay-1", "pay-2", "pay-3"],
      customersAffected: 3,
    },
  ],
};

const SUMMARY = {
  growthOpportunities: 12,
  crossSellsAuthorized: 2,
  upsellsAuthorized: 1,
  bundlesAuthorized: 0,
  recoveredOrders: 1,
  opportunityValue: { amountMinor: 900_000, currency: CURRENCY },
  observedCapturedValue: { amountMinor: 2_100_000, currency: CURRENCY },
  blockedByGovernance: 4,
  recoveredValue: { amountMinor: 350_000, currency: CURRENCY },
  pendingApprovals: 3,
  automatedActions: [
    { actionType: "GROWTH_OPPORTUNITY_SCAN", count: 5, lastAt: "2026-09-02T09:00:00.000Z" },
    { actionType: "CROSS_SELL", count: 2, lastAt: "2026-09-01T09:00:00.000Z" },
  ],
};

const GATEWAY_METRICS = {
  totalDecisions: 0,
  autoApprovalRatePct: null,
  medianDecisionLatencyMs: null,
  decisionsWithWrittenReasonPct: null,
  negotiatorAovLiftPct: null,
  basis: "No decisions yet.",
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/growth/revenue-opportunities")
        ? REPORT
        : url.includes("/growth/summary")
          ? SUMMARY
          : url.includes("/agent-gateway/metrics")
            ? GATEWAY_METRICS
            : url.includes("/ledger")
              ? { items: [], pagination: { page: 1, limit: 10, total: 0 } }
              : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <OverviewPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(stubFetch);
afterEach(() => vi.unstubAllGlobals());

describe("Overview — Merchant Today and the four evidence stages", () => {
  it("leads with today's briefing, then tells observed → detected → did → resulted", async () => {
    renderOverview();
    await screen.findByText("Observed business state");

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 5)).toEqual([
      "Today at a glance",
      "Observed business state",
      "What your agent detected",
      "What your agent did about it",
      "What actually came of it",
    ]);
  });

  it("shows observed revenue and revenue at risk as OBSERVED, not projections", async () => {
    renderOverview();
    await screen.findByText("Captured revenue");

    expect(screen.getByText("₹89,599.00")).toBeInTheDocument();
    expect(screen.getByText("Revenue at risk")).toBeInTheDocument();
    // The same amount also appears on the opportunity card that produced
    // it, which is correct — the tile is the roll-up of that card.
    expect(screen.getAllByText("₹12,400.00").length).toBeGreaterThan(0);
    // Two OBSERVED tiles in stage one.
    expect(screen.getAllByText("Observed").length).toBeGreaterThanOrEqual(2);
  });

  it("labels the ceiling as potential and the projection as estimated", async () => {
    renderOverview();
    await screen.findByText("Addressable ceiling");

    expect(screen.getByText("₹35,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("Potential Opportunity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹4,200.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Estimated Incremental").length).toBeGreaterThan(0);
  });

  it("says out loud when opportunities withheld an estimate", async () => {
    renderOverview();
    // A quietly-low estimate with no explanation is the failure mode here.
    expect(await screen.findByText(/2 opportunities withheld an estimate/)).toBeInTheDocument();
  });
});

describe("Overview — never fabricates revenue", () => {
  it("prints no blended total of the four value classes", async () => {
    renderOverview();
    await screen.findByText("Captured revenue");

    // Any of these appearing would mean two classes had been added.
    const forbidden = [
      REPORT.totals.totalAtRiskMinor + REPORT.totals.totalAddressableMinor,
      REPORT.totals.totalAddressableMinor + REPORT.totals.totalExpectedIncrementalMinor,
      REPORT.observed.capturedRevenueMinor + REPORT.totals.totalAddressableMinor,
      SUMMARY.observedCapturedValue.amountMinor + SUMMARY.recoveredValue.amountMinor,
    ];
    for (const minor of forbidden) {
      const rendered = `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
      expect(screen.queryByText(rendered), `blended total ${rendered} must never be shown`).toBeNull();
    }
  });

  it("marks captured and recovered money as provider-verified, and nothing else", async () => {
    renderOverview();
    await screen.findByText("Captured on agent-proposed orders");

    expect(screen.getAllByText("₹21,000.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("₹3,500.00")).toBeInTheDocument();
    // Exactly the two verified results — the strongest claim on the page
    // must not spread to figures that have not earned it.
    expect(screen.getAllByText("Provider-verified")).toHaveLength(2);
  });

  it("refuses to claim uplift it cannot support", async () => {
    renderOverview();
    expect(await screen.findByText(/no control group/i)).toBeInTheDocument();
  });
});

describe("Overview — real agent activity", () => {
  it("lists what the agent did from its own ledger entries", async () => {
    renderOverview();
    await screen.findByText("Acting without being asked");

    expect(screen.getByText("Scanned your catalogue for opportunities")).toBeInTheDocument();
    expect(screen.getByText("Proposed a cross-sell")).toBeInTheDocument();
    expect(screen.getByText("5×")).toBeInTheDocument();
  });

  it("surfaces pending approvals as an action, not a statistic", async () => {
    renderOverview();
    const cta = await screen.findByRole("link", { name: /Decide 3 pending approvals/ });
    expect(cta).toHaveAttribute("href", "/merchant/governance/approvals");
  });

  it("shows what governance blocked, so it never reads as the AI always winning", async () => {
    renderOverview();
    const tile = (await screen.findByText("Blocked by governance")).closest("div");
    expect(tile?.textContent).toContain("4");
  });
});

describe("Overview — every opportunity connects to a real action", () => {
  it("gives the recovery opportunity a working recovery control", async () => {
    renderOverview();
    await screen.findByText("Recover 3 failed payments");

    // The card must state why it fired and what could go wrong, and offer
    // the agent action rather than a dead button.
    expect(screen.getByText(/Three payments failed on a retryable provider error/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recover/i })).toBeInTheDocument();
  });

  it("scores the merchant and their AI-buyer readiness", async () => {
    renderOverview();
    expect(await screen.findByText("Merchant Growth Score")).toBeInTheDocument();
    expect(screen.getByText("AI Buyer Readiness")).toBeInTheDocument();
  });
});
