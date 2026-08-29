import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/auth/RequireAuth";

const LoginPage = lazy(() => import("./routes/LoginPage"));
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
const NotFoundPage = lazy(() => import("./routes/NotFoundPage"));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
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
