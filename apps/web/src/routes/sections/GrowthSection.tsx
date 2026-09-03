/**
 * 📈 Growth — one autonomous system, not an analytics workspace.
 *
 * WHAT WAS SPLIT AND WHY IT IS NOT ANYMORE
 *
 * "Growth Opportunities" answered *what is worth doing*, and lived here.
 * "Offers & Actions" answered *what has been offered and what it earned*,
 * and lived two clicks away under Merchant Agent. That split was defensible
 * when the merchant was the one deciding and executing — they are two
 * different jobs a person does at two different times.
 *
 * They are not two jobs anymore. The agent detects, ranks, proposes,
 * checks policy, executes inside the merchant's boundaries and records the
 * result. Detection and outcome are two ends of one loop, and putting them
 * on separate pages meant nothing on screen ever closed it: a merchant
 * could see nine opportunities on one page and a campaign's revenue on
 * another, with no way to tell whether the second came from the first.
 *
 *   Opportunities  what the engine found, ranked, with evidence
 *   Offers         what the agent actually offered on real baskets
 *   Results        what a real holdout says the offers caused
 *   Boundaries     the goals and limits the merchant sets
 *
 * The last tab is the point of the whole section. The merchant's job under
 * this product is to say what the agent may do; the agent's job is the
 * rest. Those boundaries were read-only until now, which made that
 * sentence half true.
 */
import { Outlet } from "react-router-dom";
import { SectionTabs } from "../../components/layout/SectionTabs";

const TABS = [
  { to: "/merchant/growth/opportunities", label: "Opportunities" },
  { to: "/merchant/growth/offers", label: "Offers" },
  { to: "/merchant/growth/results", label: "Results" },
  { to: "/merchant/growth/boundaries", label: "Boundaries" },
] as const;

export default function GrowthSection() {
  return (
    <div className="space-y-6">
      <SectionTabs tabs={TABS} />
      <Outlet />
    </div>
  );
}
