import type { Merchant, MerchantPolicy } from "@prisma/client";
import type { MerchantDTO, MerchantPolicyDTO } from "@razorgrowth/contracts";

export function toMerchantDTO(merchant: Merchant): MerchantDTO {
  return {
    id: merchant.id,
    name: merchant.name,
    slug: merchant.slug,
    description: merchant.description,
    defaultCurrency: merchant.defaultCurrency,
    businessCategory: merchant.businessCategory,
    status: merchant.status,
    createdAt: merchant.createdAt.toISOString(),
    updatedAt: merchant.updatedAt.toISOString(),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function toMerchantPolicyDTO(policy: MerchantPolicy): MerchantPolicyDTO {
  return {
    merchantId: policy.merchantId,
    policyVersion: policy.policyVersion,
    currency: policy.currency,
    maxDiscountBps: policy.maxDiscountBps,
    autoApprovalDiscountBps: policy.autoApprovalDiscountBps,
    maxOrderAmount: { amountMinor: policy.maxOrderAmountMinor, currency: policy.currency },
    autoApprovalOrderAmount: { amountMinor: policy.autoApprovalOrderAmountMinor, currency: policy.currency },
    maxRecoveryAttempts: policy.maxRecoveryAttempts,
    // PART 08 boundaries. The JSON columns are parsed rather than cast:
    // a malformed row should read as "no restriction configured" here,
    // not throw from inside a route serialiser.
    minMarginBps: policy.minMarginBps,
    maxAutonomousActionsPerDay: policy.maxAutonomousActionsPerDay,
    recoveryEnabled: policy.recoveryEnabled,
    prohibitedActions: asStringArray(policy.prohibitedActions),
    eligibleCategories: asStringArray(policy.eligibleCategories),
    minCustomerPaidOrders: policy.minCustomerPaidOrders,
    proposalValidityMinutes: policy.proposalValidityMinutes,
    approvalValidityMinutes: policy.approvalValidityMinutes,
    authorizationValidityMinutes: policy.authorizationValidityMinutes,
    updatedAt: policy.updatedAt.toISOString(),
  };
}
