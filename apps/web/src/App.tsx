import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/auth/RequireAuth";

const LoginPage = lazy(() => import("./routes/LoginPage"));
const LandingPage = lazy(() => import("./routes/LandingPage"));
const CustomerHomePage = lazy(() => import("./routes/CustomerHomePage"));
const AdminPlatformPage = lazy(() => import("./routes/AdminPlatformPage"));
const MarketplaceDiscoverPage = lazy(() => import("./routes/MarketplaceDiscoverPage"));
const CustomerPolicyPage = lazy(() => import("./routes/CustomerPolicyPage"));
const CustomerHistoryPage = lazy(() => import("./routes/CustomerHistoryPage"));
const OverviewPage = lazy(() => import("./routes/OverviewPage"));
const ReadinessPage = lazy(() => import("./routes/ReadinessPage"));
const CatalogPage = lazy(() => import("./routes/CatalogPage"));
const ProductDetailPage = lazy(() => import("./routes/ProductDetailPage"));
const GrowthPage = lazy(() => import("./routes/GrowthPage"));
const ApprovalsPage = lazy(() => import("./routes/ApprovalsPage"));
const TransactionsPage = lazy(() => import("./routes/TransactionsPage"));
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
      <Route path="/login/:role" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/customer" element={<Navigate to="/customer/home" replace />} />
          <Route path="/customer/home" element={<CustomerHomePage />} />
          <Route path="/customer/buyer-agent" element={<AiBuyerPage />} />
          <Route path="/customer/discover" element={<MarketplaceDiscoverPage />} />
          <Route path="/customer/orders" element={<CustomerHistoryPage />} />
          <Route path="/customer/payments" element={<CustomerHistoryPage />} />
          <Route path="/customer/activity" element={<CustomerHistoryPage />} />
          <Route path="/customer/policy" element={<CustomerPolicyPage />} />
          <Route path="/merchant" element={<Navigate to="/merchant/overview" replace />} />
          <Route path="/merchant/overview" element={<OverviewPage />} />
          <Route path="/merchant/growth" element={<GrowthPage />} />
          <Route path="/merchant/ai-buyers" element={<AgentGatewayPage />} />
          <Route path="/merchant/catalog" element={<CatalogPage />} />
          <Route path="/merchant/offers" element={<GrowthPage />} />
          <Route path="/merchant/payments" element={<TransactionsPage />} />
          <Route path="/merchant/policies" element={<SettingsPage />} />
          <Route path="/merchant/readiness" element={<ReadinessPage />} />
          <Route path="/merchant/ledger" element={<ActionLedgerPage />} />
          <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
          <Route path="/admin/:section" element={<AdminPlatformPage />} />
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
