import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/auth/RequireAuth";

const LoginPage = lazy(() => import("./routes/LoginPage"));
const LandingPage = lazy(() => import("./routes/LandingPage"));
const CustomerHomePage = lazy(() => import("./routes/CustomerHomePage"));
const MarketplaceDiscoverPage = lazy(() => import("./routes/MarketplaceDiscoverPage"));
const CustomerProductPage = lazy(() => import("./routes/CustomerProductPage"));
const CustomerPolicyPage = lazy(() => import("./routes/CustomerPolicyPage"));
const CustomerHistoryPage = lazy(() => import("./routes/CustomerHistoryPage"));
const OverviewPage = lazy(() => import("./routes/OverviewPage"));
const ReadinessPage = lazy(() => import("./routes/ReadinessPage"));
const CatalogPage = lazy(() => import("./routes/CatalogPage"));
const ProductDetailPage = lazy(() => import("./routes/ProductDetailPage"));
const GrowthPage = lazy(() => import("./routes/GrowthPage"));
const OffersPage = lazy(() => import("./routes/GrowthPage").then((m) => ({ default: m.OffersPage })));
const ApprovalsPage = lazy(() => import("./routes/ApprovalsPage"));
const TransactionsPage = lazy(() => import("./routes/TransactionsPage"));
const PostPurchasePage = lazy(() => import("./routes/PostPurchasePage"));
const ActionLedgerPage = lazy(() => import("./routes/ActionLedgerPage"));
const AiBuyerPage = lazy(() => import("./routes/AiBuyerPage"));
const SettingsPage = lazy(() => import("./routes/SettingsPage"));
const ActivityPage = lazy(() => import("./routes/ActivityPage"));
const AgentGatewayPage = lazy(() => import("./routes/AgentGatewayPage"));
const ProtocolsPage = lazy(() => import("./routes/ProtocolsPage"));
const TrustTracePage = lazy(() => import("./routes/TrustTracePage"));
const BreakTheAgentPage = lazy(() => import("./routes/BreakTheAgentPage"));
const DemoTourPage = lazy(() => import("./routes/DemoTourPage"));
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
          <Route path="/customer" element={<Navigate to="/customer/home" replace />} />
          <Route path="/customer/home" element={<CustomerHomePage />} />
          <Route path="/customer/buyer-agent" element={<AiBuyerPage />} />
          <Route path="/customer/discover" element={<MarketplaceDiscoverPage />} />
          {/* A shopper following "View details" from a recommendation used to
              land on `/catalog/:id`, whose first path segment is not their
              role — RequireAuth bounced them to the Buyer Agent home and the
              conversation they were reading vanished. Same page, reachable
              under the role that is allowed to reach it. */}
          <Route path="/customer/product/:productId" element={<CustomerProductPage />} />
          <Route path="/customer/orders" element={<CustomerHistoryPage />} />
          <Route path="/customer/payments" element={<CustomerHistoryPage />} />
          <Route path="/customer/activity" element={<CustomerHistoryPage />} />
          <Route path="/customer/policy" element={<CustomerPolicyPage />} />
          <Route path="/merchant" element={<Navigate to="/merchant/overview" replace />} />
          <Route path="/merchant/overview" element={<OverviewPage />} />
          <Route path="/merchant/growth" element={<GrowthPage />} />
          <Route path="/merchant/ai-buyers" element={<AgentGatewayPage />} />
          <Route path="/merchant/catalog" element={<CatalogPage />} />
          <Route path="/merchant/offers" element={<OffersPage />} />
          <Route path="/merchant/payments" element={<TransactionsPage />} />
          <Route path="/merchant/post-purchase" element={<PostPurchasePage />} />
          <Route path="/merchant/policies" element={<SettingsPage />} />
          <Route path="/merchant/readiness" element={<ReadinessPage />} />
          <Route path="/merchant/ledger" element={<ActionLedgerPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/demo" element={<DemoTourPage />} />
          <Route path="/agent-gateway" element={<AgentGatewayPage />} />
          <Route path="/protocols" element={<ProtocolsPage />} />
          <Route path="/ai-buyer" element={<AiBuyerPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/catalog/:productId" element={<ProductDetailPage />} />
          <Route path="/growth" element={<GrowthPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/readiness" element={<ReadinessPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/post-purchase" element={<PostPurchasePage />} />
          <Route path="/action-ledger" element={<ActionLedgerPage />} />
          <Route path="/trust-trace" element={<TrustTracePage />} />
          <Route path="/break-the-agent" element={<BreakTheAgentPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
