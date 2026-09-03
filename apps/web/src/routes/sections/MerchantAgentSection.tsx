/**
 * 🤖 Merchant Agent — the merchant's OWN agent, and everything about
 * whether it can act.
 *
 * Three tabs, in the order a merchant meets them:
 *
 *   Console             what the agent is working on, what it did on its
 *                       own, and the control that runs a cycle.
 *   Readiness           whether the catalogue is good enough for the
 *                       agent to have anything to say.
 *   Connect             the addresses an outside agent uses to find and
 *                       buy from this merchant at all.
 *
 * Readiness and Connect used to be separate sidebar destinations, which
 * made them read as unrelated diagnostics. They are not: they are the two
 * preconditions for this agent working, so they live with it.
 *
 * "Proposals & Offers" moved to Growth. What the agent offered and what
 * that earned are two ends of the growth loop, and they were on a
 * different page from the detections that started it.
 */
import { Outlet } from "react-router-dom";
import { SectionTabs } from "../../components/layout/SectionTabs";

const TABS = [
  { to: "/merchant/agent/console", label: "Console" },
  { to: "/merchant/agent/readiness", label: "Readiness" },
  { to: "/merchant/agent/connect", label: "Connect" },
] as const;

export default function MerchantAgentSection() {
  return (
    <div className="space-y-6">
      <SectionTabs tabs={TABS} />
      <Outlet />
    </div>
  );
}
