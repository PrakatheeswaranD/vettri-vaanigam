/**
 * 🛡 Governance — the control system that makes an autonomous agent safe.
 *
 * THREE TABS, NOT SIX
 *
 * There were six, and the reason to cut to three is not tidiness. Six tabs
 * present six equally-weighted destinations, and these are not equal:
 *
 *   Policies      the boundaries. The merchant's actual job here, and the
 *                 only tab where anything is DECIDED.
 *   Approvals     what those boundaries pushed to a human.
 *   Agent Ledger  what happened, at whatever depth you need — the feed,
 *                 one workflow's full trace, and the raw hash-chained
 *                 record behind both.
 *
 * A merchant asking "is this agent safe" needs those three in that order:
 * what may it do, what is it asking me, what has it done. Everything else
 * was a different depth of the third question wearing its own tab.
 *
 * NOTHING WAS DELETED
 *
 * The gateway decision feed, the end-to-end trust trace and the adversarial
 * sandbox are all still routed and still reachable — Decisions and Trace
 * from inside Agent Ledger, the Sandbox from Policies, where "prove these
 * boundaries hold" is the question a merchant is actually asking when they
 * look at it. Their old URLs still resolve. What changed is which of them
 * is a top-level destination, because a tab bar is a claim about what
 * matters most.
 */
import { Outlet } from "react-router-dom";
import { SectionTabs } from "../../components/layout/SectionTabs";

const TABS = [
  { to: "/merchant/governance/policies", label: "Policies" },
  { to: "/merchant/governance/approvals", label: "Approvals" },
  { to: "/merchant/governance/ledger", label: "Agent Ledger" },
] as const;

export default function GovernanceSection() {
  return (
    <div className="space-y-6">
      <SectionTabs tabs={TABS} />
      <Outlet />
    </div>
  );
}
