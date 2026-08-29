import {
  Activity,
  LayoutDashboard,
  Bot,
  Package,
  TrendingUp,
  Gauge,
  Receipt,
  ScrollText,
  ShieldQuestion,
  Sparkles,
  Swords,
  Radio,
  SlidersHorizontal,
  Plug,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** One plain sentence, shown under the label on hover/expanded. A
   * merchant should never have to click a nav item to learn what it is. */
  hint: string;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Navigation, rewritten for a merchant rather than an engineer.
 *
 * THE PROBLEM THIS FIXES
 *
 * Fourteen destinations across four groups, labelled in the vocabulary of
 * the codebase — "Trust Trace", "Action Ledger", "Readiness", "Agent
 * Configuration". Each name is accurate and none of them tells a merchant
 * what they would find there or why they would go.
 *
 * TWO RULES APPLIED
 *
 * 1. Every label answers "what do I get?", not "what is this called
 *    internally?" — `Rules` rather than `Agent Configuration`,
 *    `Proof` rather than `Trust Trace`.
 * 2. Every item carries a one-line hint. If a name needs explaining, the
 *    explanation belongs next to it, not in documentation nobody opens.
 *
 * Order is by how often a merchant actually needs it: what happened today
 * first, the rules that govern it second, evidence third, everything else
 * after.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "run",
    label: "Run",
    items: [
      {
        to: "/overview",
        label: "Home",
        icon: LayoutDashboard,
        hint: "Today at a glance",
      },
      {
        to: "/agent-gateway",
        label: "Agent Requests",
        icon: Radio,
        hint: "Every AI agent that tried to buy, and what you decided",
      },
      {
        to: "/activity",
        label: "Activity",
        icon: Activity,
        hint: "A plain timeline of everything that happened",
      },
      {
        to: "/approvals",
        label: "Waiting for You",
        icon: ShieldQuestion,
        hint: "Purchases too large to approve automatically",
      },
    ],
  },
  {
    id: "setup",
    label: "Set up",
    items: [
      {
        to: "/protocols",
        label: "Connect an Agent",
        icon: Plug,
        hint: "Your public address, and the protocols agents can use",
      },
      {
        to: "/settings",
        label: "Rules",
        icon: SlidersHorizontal,
        hint: "Spending limits, blocked categories, discount ceiling",
      },
      {
        to: "/catalog",
        label: "Products",
        icon: Package,
        hint: "What an AI agent can see and buy from you",
      },
      {
        to: "/ai-buyer",
        label: "Agent's-Eye View",
        icon: Bot,
        hint: "What agents understand — and what they cannot buy",
      },
      {
        to: "/readiness",
        label: "Readiness Score",
        icon: Gauge,
        hint: "How ready your catalogue is for AI buyers",
      },
    ],
  },
  {
    id: "proof",
    label: "Proof",
    items: [
      {
        to: "/trust-trace",
        label: "Order Trail",
        icon: Sparkles,
        hint: "Follow one order from request to payment",
      },
      {
        to: "/break-the-agent",
        label: "Try to Break It",
        icon: Swords,
        hint: "Watch real attacks get refused",
      },
      {
        to: "/action-ledger",
        label: "Audit Log",
        icon: ScrollText,
        hint: "The tamper-evident record, for auditors",
      },
    ],
  },
  {
    id: "money",
    label: "Money",
    items: [
      {
        to: "/growth",
        label: "Basket Growth",
        icon: TrendingUp,
        hint: "What the negotiator offered, inside your limits",
      },
      {
        to: "/transactions",
        label: "Payments",
        icon: Receipt,
        hint: "Orders and payment outcomes",
      },
    ],
  },
];

/** Flat lookup so a page can render its own name/hint without repeating it. */
export const NAV_LOOKUP: Record<string, NavItem> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items).map((i) => [i.to, i]),
);
