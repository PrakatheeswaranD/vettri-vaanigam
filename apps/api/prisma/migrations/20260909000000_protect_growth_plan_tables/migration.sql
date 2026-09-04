-- Merchant operational records are served exclusively by tenant-scoped API
-- routes. Direct client database roles receive no permissive RLS policies.
ALTER TABLE "GrowthPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GrowthPlanItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentJob" ENABLE ROW LEVEL SECURITY;
