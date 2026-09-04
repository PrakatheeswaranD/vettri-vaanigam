import { Activity, Bot, Compass, Gauge, LayoutDashboard, Package, Receipt, Search, Settings2, ShieldCheck, ShoppingBag, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import type { ExperienceRole } from "../../lib/experience-role";

export interface NavItem { to: string; label: string; icon: LucideIcon; hint: string }
export interface NavSection { id: string; label: string; items: NavItem[] }

export const ROLE_LABELS: Record<ExperienceRole, string> = {
  customer: "Customer · Buy with AI",
  merchant: "Merchant · Grow with AI",
  admin: "Platform · Operate",
};

/**
 * The whole product, in eleven links.
 *
 * WHAT THIS REPLACED
 *
 * Nineteen merchant entries in two groups, and seven customer ones. Each
 * pointed at a real screen, so nothing was broken — but "Growth
 * Opportunities", "Offers & Actions", "Agent Ledger" and "Agent Activity"
 * are four labels for two ideas, and a merchant could not tell from the
 * list which one answered the question they had. A navigation that long
 * stops being navigation and becomes a directory.
 *
 * Track 01 is two capabilities: a merchant growing revenue with AI, and AI
 * buyers completing real commerce. So the merchant sees five destinations
 * and the shopper sees six, each named for what it is FOR rather than
 * which subsystem produced it. Where a destination has genuinely distinct
 * views — Products vs Orders vs Payments — those are tabs inside it, which
 * keeps them one click away without putting them in this list.
 *
 * NO SECTION GROUPING ANYMORE
 *
 * Five items do not need to be split into "Revenue Growth" and "Merchant
 * Automation". That split was itself a symptom: it existed to make
 * nineteen items scannable, and it put policy, approvals and decisions in
 * different halves of a list even though they are the same subject.
 */
export const NAV_BY_ROLE: Record<ExperienceRole, NavSection[]> = {
  customer: [{ id: "customer", label: "Buy with AI", items: [
    { to: "/customer/buyer-agent", label: "Buyer Agent", icon: Bot, hint: "Describe what you need, review what it proposes" },
    { to: "/customer/discover", label: "Discover", icon: Search, hint: "Shop products across AI-ready merchants" },
    { to: "/customer/orders", label: "Orders", icon: Package, hint: "Purchases your agent carried through" },
    { to: "/customer/payments", label: "Payments", icon: Receipt, hint: "Where the money actually is" },
    { to: "/customer/activity", label: "Agent Activity", icon: Compass, hint: "Every proposal, refusal, and the reason" },
    { to: "/customer/policy", label: "Spending Policy", icon: ShieldCheck, hint: "What your agent may spend without asking" },
  ] }],

  merchant: [
    { id: "merchant", label: "Grow with AI", items: [
      { to: "/merchant/overview", label: "Home", icon: LayoutDashboard, hint: "Today's performance, decisions, and agent work" },
      { to: "/merchant/growth/opportunities", label: "Opportunities", icon: TrendingUp, hint: "The best actions to grow profit, ranked for you" },
      { to: "/merchant/commerce/orders", label: "Customers & Orders", icon: ShoppingBag, hint: "Customers, orders, products, payments, and returns" },
      { to: "/merchant/growth/boundaries", label: "Agent Controls", icon: Settings2, hint: "Budgets, contact rules, discounts, and autonomy" },
      { to: "/merchant/governance/ledger", label: "Activity", icon: Activity, hint: "A plain-language record of what the agent did" },
    ] },
    { id: "merchant-advanced", label: "Advanced", items: [
      { to: "/merchant/agent/console", label: "Agent Console", icon: Bot, hint: "Run cycles and inspect the agent's working state" },
      { to: "/merchant/agent/readiness", label: "Readiness", icon: Sparkles, hint: "Fix what prevents agents from finding and buying products" },
      { to: "/merchant/agent/connect", label: "Protocols", icon: Compass, hint: "Technical endpoints for external buyer agents" },
      { to: "/merchant/governance/policies", label: "Advanced Policies", icon: ShieldCheck, hint: "Financial rules, gateway decisions, and security tools" },
    ] },
  ],

  // Deliberately one entry. The platform operator needs a place to land
  // and a way to reach the `/admin/*` surface; they do not need a parallel
  // console, and the last attempt at one was removed for good reason.
  admin: [{ id: "platform", label: "Platform", items: [
    { to: "/admin/platform", label: "Platform Operations", icon: Gauge, hint: "Merchants, payment risk, and the platform audit trail" },
  ] }],
};

export const getNavSections = (role: ExperienceRole): NavSection[] => NAV_BY_ROLE[role];
