/**
 * Routes — five merchant destinations, six customer ones.
 *
 * WHAT CHANGED, AND WHY
 *
 * The console had nineteen merchant destinations across two nav groups.
 * Every one was a real screen, but the grouping was arbitrary: "AI Buyers"
 * sat apart from "Action Approvals" and "Agent Policies" even though a
 * policy is the rule, a decision is that rule applied, and an approval is
 * that rule deferring to a human. A merchant chasing one order's story
 * walked the sidebar four times.
 *
 * Track 01 is two capabilities — a merchant growing revenue with AI, and
 * AI buyers completing real commerce — so the sidebar now names five
 * places a merchant goes, and what used to be its own destination is a tab
 * inside the one it belongs to. Tabs are real nested routes, so a merchant
 * can still link someone straight to Governance → Approvals.
 *
 * Everything that moved kept its component. Nothing here is a rewrite of a
 * working screen; the pages that were removed were removed because they
 * duplicated one that stayed, and their non-duplicated half was moved into
 * it first (see `TRACK01_PART1_RESTRUCTURE.md`).
 *
 * Old paths redirect rather than 404. Some of them were shipped in demo
 * links and screenshots, and a dead link is a worse outcome than a
 * redirect that costs nothing.
 */
import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/auth/RequireAuth";

const LoginPage = lazy(() => import("./routes/LoginPage"));
const LandingPage = lazy(() => import("./routes/LandingPage"));

// —— Customer ——————————————————————————————————————————————————————————
const AiBuyerPage = lazy(() => import("./routes/AiBuyerPage"));
const MarketplaceDiscoverPage = lazy(() => import("./routes/MarketplaceDiscoverPage"));
const CustomerProductPage = lazy(() => import("./routes/CustomerProductPage"));
const CustomerPolicyPage = lazy(() => import("./routes/CustomerPolicyPage"));
const CustomerOrdersPage = lazy(() => import("./routes/CustomerHistoryPage").then((m) => ({ default: m.CustomerOrdersPage })));
const CustomerPaymentsPage = lazy(() => import("./routes/CustomerHistoryPage").then((m) => ({ default: m.CustomerPaymentsPage })));
const CustomerActivityPage = lazy(() => import("./routes/CustomerActivityPage"));

// —— Merchant: sections ————————————————————————————————————————————————
const MerchantAgentSection = lazy(() => import("./routes/sections/MerchantAgentSection"));
const CommerceSection = lazy(() => import("./routes/sections/CommerceSection"));
const GovernanceSection = lazy(() => import("./routes/sections/GovernanceSection"));
const GrowthSection = lazy(() => import("./routes/sections/GrowthSection"));

// —— Merchant: screens —————————————————————————————————————————————————
const OverviewPage = lazy(() => import("./routes/OverviewPage"));
const GrowthOpportunitiesPage = lazy(() => import("./routes/GrowthOpportunitiesPage"));
const AgentConsolePage = lazy(() => import("./routes/AgentConsolePage"));
const OffersPage = lazy(() => import("./routes/GrowthPage"));
const GrowthResultsPage = lazy(() => import("./routes/GrowthResultsPage"));
const GrowthBoundariesPage = lazy(() => import("./routes/GrowthBoundariesPage"));
const ReadinessPage = lazy(() => import("./routes/ReadinessPage"));
const ProtocolsPage = lazy(() => import("./routes/ProtocolsPage"));
const CatalogPage = lazy(() => import("./routes/CatalogPage"));
const MerchantProductPage = lazy(() => import("./routes/ProductDetailPage"));
const MerchantOrdersPage = lazy(() => import("./routes/commerce/CommerceOrdersPage"));
const MerchantCustomersPage = lazy(() => import("./routes/commerce/CommerceCustomersPage"));
const MerchantPaymentsPage = lazy(() => import("./routes/commerce/CommercePaymentsPage"));
const PostPurchasePage = lazy(() => import("./routes/PostPurchasePage"));
const AgentGatewayPage = lazy(() => import("./routes/AgentGatewayPage"));
const ApprovalsPage = lazy(() => import("./routes/ApprovalsPage"));
const SettingsPage = lazy(() => import("./routes/SettingsPage"));
const TrustTracePage = lazy(() => import("./routes/TrustTracePage"));
const ActionLedgerPage = lazy(() => import("./routes/ActionLedgerPage"));
const BreakTheAgentPage = lazy(() => import("./routes/BreakTheAgentPage"));

// —— Platform operator ————————————————————————————————————————————————
const PlatformAdminPage = lazy(() => import("./routes/PlatformAdminPage"));

const NotFoundPage = lazy(() => import("./routes/NotFoundPage"));

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* `/login/:role` used to open a per-role screen with a credentials
          form. There is one entry screen now, so any old link lands on it
          rather than 404ing. */}
      <Route path="/login/:role" element={<Navigate to="/login" replace />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* ——————————————————————————————————— CUSTOMER — 6 destinations */}
          <Route path="/customer" element={<Navigate to="/customer/buyer-agent" replace />} />
          <Route path="/customer/buyer-agent" element={<AiBuyerPage />} />
          <Route path="/customer/discover" element={<MarketplaceDiscoverPage />} />
          <Route path="/customer/discover/:productId" element={<CustomerProductPage />} />
          <Route path="/customer/orders" element={<CustomerOrdersPage />} />
          <Route path="/customer/payments" element={<CustomerPaymentsPage />} />
          <Route path="/customer/activity" element={<CustomerActivityPage />} />
          <Route path="/customer/policy" element={<CustomerPolicyPage />} />
          {/* Home was three restatements of this navigation plus one useful
              strip, which now sits on the Buyer Agent screen. Cart was the
              agent's own un-authorized proposals, which belong with the
              conversation that produced them. */}
          <Route path="/customer/home" element={<Navigate to="/customer/buyer-agent" replace />} />
          <Route path="/customer/cart" element={<Navigate to="/customer/buyer-agent" replace />} />
          <Route path="/customer/product/:productId" element={<CustomerProductPage />} />

          {/* ——————————————————————————————————— MERCHANT — 5 destinations */}
          <Route path="/merchant" element={<Navigate to="/merchant/overview" replace />} />

          {/* 🚀 Overview */}
          <Route path="/merchant/overview" element={<OverviewPage />} />

          {/* 🤖 Merchant Agent */}
          <Route path="/merchant/agent" element={<MerchantAgentSection />}>
            <Route index element={<Navigate to="/merchant/agent/console" replace />} />
            <Route path="console" element={<AgentConsolePage />} />
            <Route path="readiness" element={<ReadinessPage />} />
            <Route path="connect" element={<ProtocolsPage />} />
          </Route>

          {/* 📈 Growth — the autonomous growth system */}
          <Route path="/merchant/growth" element={<GrowthSection />}>
            <Route index element={<Navigate to="/merchant/growth/opportunities" replace />} />
            <Route path="opportunities" element={<GrowthOpportunitiesPage />} />
            <Route path="offers" element={<OffersPage />} />
            <Route path="results" element={<GrowthResultsPage />} />
            <Route path="boundaries" element={<GrowthBoundariesPage />} />
          </Route>

          {/* 🛍 Commerce */}
          <Route path="/merchant/commerce" element={<CommerceSection />}>
            <Route index element={<Navigate to="/merchant/commerce/products" replace />} />
            <Route path="products" element={<CatalogPage />} />
            <Route path="products/:productId" element={<MerchantProductPage />} />
            <Route path="orders" element={<MerchantOrdersPage />} />
            <Route path="customers" element={<MerchantCustomersPage />} />
            <Route path="payments" element={<MerchantPaymentsPage />} />
            <Route path="post-purchase" element={<PostPurchasePage />} />
          </Route>

          {/* 🛡 Governance */}
          <Route path="/merchant/governance" element={<GovernanceSection />}>
            {/* Policies first: the only governance tab where a merchant
                decides anything. */}
            <Route index element={<Navigate to="/merchant/governance/policies" replace />} />
            <Route path="decisions" element={<AgentGatewayPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="policies" element={<SettingsPage />} />
            <Route path="trace" element={<TrustTracePage />} />
            <Route path="ledger" element={<ActionLedgerPage />} />
            <Route path="sandbox" element={<BreakTheAgentPage />} />
          </Route>

          {/* ——————————————————————————————— PLATFORM OPERATOR — 1 screen */}
          <Route path="/admin" element={<Navigate to="/admin/platform" replace />} />
          <Route path="/admin/platform" element={<PlatformAdminPage />} />

          {/* ————————————————————————————————— Where things used to live */}
          <Route path="/merchant/ai-buyers" element={<Navigate to="/merchant/governance/decisions" replace />} />
          <Route path="/merchant/approvals" element={<Navigate to="/merchant/governance/approvals" replace />} />
          <Route path="/merchant/policies" element={<Navigate to="/merchant/governance/policies" replace />} />
          <Route path="/merchant/trust-trace" element={<Navigate to="/merchant/governance/trace" replace />} />
          <Route path="/merchant/ledger" element={<Navigate to="/merchant/governance/ledger" replace />} />
          <Route path="/merchant/activity" element={<Navigate to="/merchant/governance/ledger" replace />} />
          <Route path="/merchant/break-the-agent" element={<Navigate to="/merchant/governance/sandbox" replace />} />
          <Route path="/merchant/catalog" element={<Navigate to="/merchant/commerce/products" replace />} />
          <Route path="/merchant/catalog/:productId" element={<Navigate to="/merchant/commerce/products" replace />} />
          <Route path="/merchant/orders" element={<Navigate to="/merchant/commerce/orders" replace />} />
          <Route path="/merchant/customers" element={<Navigate to="/merchant/commerce/customers" replace />} />
          <Route path="/merchant/payments" element={<Navigate to="/merchant/commerce/payments" replace />} />
          <Route path="/merchant/post-purchase" element={<Navigate to="/merchant/commerce/post-purchase" replace />} />
          <Route path="/merchant/analytics" element={<Navigate to="/merchant/commerce" replace />} />
          <Route path="/merchant/offers" element={<Navigate to="/merchant/growth/offers" replace />} />
          <Route path="/merchant/agent/offers" element={<Navigate to="/merchant/growth/offers" replace />} />
          <Route path="/merchant/readiness" element={<Navigate to="/merchant/agent/readiness" replace />} />
          <Route path="/merchant/protocols" element={<Navigate to="/merchant/agent/connect" replace />} />
          <Route path="/merchant/demo-tour" element={<Navigate to="/merchant/overview" replace />} />

          <Route path="/ai-buyer" element={<Navigate to="/customer/buyer-agent" replace />} />
          <Route path="/overview" element={<Navigate to="/merchant/overview" replace />} />
          <Route path="/agent-gateway" element={<Navigate to="/merchant/governance/decisions" replace />} />
          <Route path="/catalog" element={<Navigate to="/merchant/commerce/products" replace />} />
          <Route path="/catalog/:productId" element={<Navigate to="/merchant/commerce/products" replace />} />
          <Route path="/growth" element={<Navigate to="/merchant/growth" replace />} />
          <Route path="/approvals" element={<Navigate to="/merchant/governance/approvals" replace />} />
          <Route path="/readiness" element={<Navigate to="/merchant/agent/readiness" replace />} />
          <Route path="/transactions" element={<Navigate to="/merchant/commerce/payments" replace />} />
          <Route path="/post-purchase" element={<Navigate to="/merchant/commerce/post-purchase" replace />} />
          <Route path="/action-ledger" element={<Navigate to="/merchant/governance/ledger" replace />} />
          <Route path="/settings" element={<Navigate to="/merchant/governance/policies" replace />} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
