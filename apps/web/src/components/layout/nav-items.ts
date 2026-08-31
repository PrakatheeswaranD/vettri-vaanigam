import { Activity, Bot, Gauge, Home, LayoutDashboard, Package, Receipt, ScrollText, Settings, ShieldCheck, ShoppingBag, Sparkles, Store, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { ExperienceRole } from "../../lib/experience-role";

export interface NavItem { to: string; label: string; icon: LucideIcon; hint: string }
export interface NavSection { id: string; label: string; items: NavItem[] }

export const ROLE_LABELS: Record<ExperienceRole, string> = {
  customer: "Customer · Buy with AI",
  merchant: "Merchant · Grow with AI",
  admin: "Razorpay Admin · Govern AI commerce",
};

export const NAV_BY_ROLE: Record<ExperienceRole, NavSection[]> = {
  customer: [{ id: "customer", label: "Customer", items: [
    { to: "/customer/home", label: "Home", icon: Home, hint: "Your AI shopping overview" },
    { to: "/customer/buyer-agent", label: "Buyer Agent", icon: Bot, hint: "Describe intent, compare, and authorize" },
    { to: "/customer/discover", label: "Discover", icon: ShoppingBag, hint: "Explore AI-readable merchant catalogs" },
    { to: "/customer/orders", label: "Orders", icon: Package, hint: "Proposals, orders, and fulfillment" },
    { to: "/customer/payments", label: "Payments", icon: Receipt, hint: "Payment state and safe recovery" },
    { to: "/customer/activity", label: "Activity", icon: Activity, hint: "Transparent record of your AI actions" },
    { to: "/customer/policy", label: "Spending Policy", icon: ShieldCheck, hint: "Autonomous and daily purchase limits" },
  ] }],
  merchant: [{ id: "merchant", label: "Grow with AI", items: [
    { to: "/merchant/overview", label: "Overview", icon: LayoutDashboard, hint: "AI revenue and conversion at a glance" },
    { to: "/merchant/growth", label: "Growth", icon: TrendingUp, hint: "Revenue opportunities and bounded campaigns" },
    { to: "/merchant/ai-buyers", label: "AI Buyers", icon: Bot, hint: "Buyer intent and governed agent requests" },
    { to: "/merchant/catalog", label: "Catalog", icon: Package, hint: "AI-readable products and availability" },
    { to: "/merchant/offers", label: "Opportunities & Offers", icon: Sparkles, hint: "Upsell, cross-sell, and controlled offers" },
    { to: "/merchant/payments", label: "Payments", icon: Receipt, hint: "Transactions and payment operations" },
    { to: "/merchant/policies", label: "Policies", icon: Settings, hint: "Discount and autonomy boundaries" },
    { to: "/merchant/readiness", label: "AI Readiness", icon: Gauge, hint: "Discoverability and transactability score" },
    { to: "/merchant/ledger", label: "Agent Ledger", icon: ScrollText, hint: "Tamper-evident agent action record" },
  ] }],
  admin: [{ id: "admin", label: "Enable & Govern", items: [
    { to: "/admin/overview", label: "Platform Overview", icon: LayoutDashboard, hint: "AI-commerce health across the platform" },
    { to: "/admin/merchants", label: "Merchant Onboarding", icon: Store, hint: "Review merchant enablement and configuration" },
    { to: "/admin/readiness", label: "AI Readiness", icon: Gauge, hint: "Govern catalog and checkout readiness" },
    { to: "/admin/payments", label: "Payment Monitoring", icon: Receipt, hint: "Monitor transactions and uncertain states" },
    { to: "/admin/risk", label: "Risk & Exceptions", icon: ShieldCheck, hint: "Review mismatches, failures, and step-ups" },
    { to: "/admin/audit", label: "Audit Visibility", icon: ScrollText, hint: "Inspect explainable agent actions" },
    { to: "/admin/users", label: "Access Governance", icon: Users, hint: "Demo platform role boundaries" },
  ] }],
};

export const getNavSections = (role: ExperienceRole): NavSection[] => NAV_BY_ROLE[role];
export const NAV_LOOKUP: Record<string, NavItem> = Object.fromEntries(
  Object.values(NAV_BY_ROLE).flatMap((sections) => sections.flatMap((section) => section.items)).map((item) => [item.to, item]),
);
