/**
 * Agent Activity (Part 11 §43) — the merchant-friendly timeline of what
 * the specialist actually did, derived from the real Action Ledger.
 * The Action Ledger page remains the deeper technical audit source;
 * this is the same truth, narrated for a merchant.
 */
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody } from "../components/ui/Card";
import { ActivityFeed } from "../features/activity/ActivityFeed";
import { GatewayDecisionFeed } from "../components/gateway/GatewayDecisionFeed";
import { CardHeader, CardTitle } from "../components/ui/Card";

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title={"Activity"}
          lead={"A plain timeline of what happened: what outside agents asked of you, and what your own systems did about it."}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What agents asked of you</CardTitle>
        </CardHeader>
        <CardBody>
          <GatewayDecisionFeed limit={12} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What your own systems did</CardTitle>
        </CardHeader>
        <CardBody>
          <ActivityFeed limit={40} />
        </CardBody>
      </Card>

      <p className="text-xs text-ink-faint">
        Need the underlying audit detail — hashes, actors, sequence, integrity verification?{" "}
        <Link to="/action-ledger" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
          Open the Action Ledger <ArrowRight size={11} />
        </Link>
      </p>
    </div>
  );
}
