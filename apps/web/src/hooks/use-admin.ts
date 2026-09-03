/**
 * The platform operator's read surface.
 *
 * These endpoints all existed and none of them was called from anywhere in
 * the console. They are read-only here on purpose: merchant suspension and
 * onboarding are the two `/admin/*` writes, and both are consequential
 * enough that they deserve a considered flow rather than a button added
 * alongside a table. What was actually missing was the ability to SEE
 * platform state at all.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api-client";

export interface AdminOverview {
  merchants: number;
  payments: number;
  exceptions: number;
  users: number;
}

export interface AdminMerchant {
  id: string;
  name: string;
  slug: string;
  status: string;
  businessCategory: string;
  _count: { products: number };
}

export interface AdminRiskRow {
  id: string;
  merchantId: string;
  state: string;
  failureCategory: string | null;
  customerDebitStatus: string | null;
  merchantCreditStatus: string | null;
  automaticRetryBlocked: boolean;
}

export interface AdminAuditRow {
  id: string;
  merchantId: string | null;
  workflowId: string;
  actionType: string;
  status: string;
  conciseReason: string;
  eventHash: string;
  createdAt: string;
}

export function useAdminOverview() {
  return useQuery({ queryKey: ["admin", "overview"], queryFn: () => apiGet<AdminOverview>("/admin/overview") });
}

export function useAdminMerchants() {
  return useQuery({ queryKey: ["admin", "merchants"], queryFn: () => apiGet<{ items: AdminMerchant[] }>("/admin/merchants") });
}

export function useAdminRisk() {
  return useQuery({ queryKey: ["admin", "risk"], queryFn: () => apiGet<{ items: AdminRiskRow[] }>("/admin/risk") });
}

export function useAdminAudit() {
  return useQuery({ queryKey: ["admin", "audit"], queryFn: () => apiGet<{ items: AdminAuditRow[] }>("/admin/audit") });
}
