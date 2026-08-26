import {
  LayoutDashboard,
  Bot,
  Package,
  TrendingUp,
  Gauge,
  Receipt,
  ScrollText,
  ShieldQuestion,
  Settings,
  Sparkles,
  Swords,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Three-layer product information architecture (PART 09 §5): the
 * sidebar itself teaches the architecture. DISCOVER & SELL is the buyer-
 * facing commerce loop; GOVERN is where AI proposals meet deterministic
 * policy, human approval, and the auditable trace; OPERATE is
 * operational bookkeeping (orders, configuration).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "discover-sell",
    label: "Discover & Sell",
    items: [
      { to: "/overview", label: "Overview", icon: LayoutDashboard },
      { to: "/ai-buyer", label: "AI Buyer", icon: Bot },
      { to: "/catalog", label: "Catalog", icon: Package },
      { to: "/growth", label: "Growth", icon: TrendingUp },
    ],
  },
  {
    id: "govern",
    label: "Govern",
    items: [
      { to: "/approvals", label: "Approvals", icon: ShieldQuestion },
      { to: "/readiness", label: "Readiness", icon: Gauge },
      { to: "/trust-trace", label: "Trust Trace", icon: Sparkles },
      { to: "/break-the-agent", label: "Break the Agent", icon: Swords },
      { to: "/action-ledger", label: "Action Ledger", icon: ScrollText },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { to: "/transactions", label: "Transactions", icon: Receipt },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
