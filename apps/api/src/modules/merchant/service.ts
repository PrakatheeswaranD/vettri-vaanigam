import type { PrismaClient } from "@prisma/client";
import type { MerchantDTO, MerchantPolicyDTO, MerchantPolicyUpdateDTO } from "@razorgrowth/contracts";
import { appendLedgerEvent } from "../audit/ledger.js";
import { updateMerchantPolicy } from "../policy/repository.js";
import { computeMerchantStats, findMerchantById, findMerchantPolicy } from "./repository.js";
import { toMerchantDTO, toMerchantPolicyDTO } from "./mapper.js";

export async function getMerchantProfile(prisma: PrismaClient, merchantId: string): Promise<MerchantDTO> {
  const merchant = await findMerchantById(prisma, merchantId);
  return toMerchantDTO(merchant);
}

export async function getMerchantPolicyView(prisma: PrismaClient, merchantId: string): Promise<MerchantPolicyDTO> {
  const policy = await findMerchantPolicy(prisma, merchantId);
  return toMerchantPolicyDTO(policy);
}

/** PART 05 §75-§76 — the only way `MerchantPolicy` may change: server
 * validation (already run by `merchantPolicyUpdateSchema` before this is
 * called), a version increment (`updateMerchantPolicy`), and an audit
 * event recording exactly what changed — never a silent frontend-only
 * edit. */
export async function updateMerchantPolicyView(
  prisma: PrismaClient,
  merchantId: string,
  update: MerchantPolicyUpdateDTO,
): Promise<MerchantPolicyDTO> {
  const before = await findMerchantPolicy(prisma, merchantId);
  const policy = await updateMerchantPolicy(prisma, merchantId, update);

  await appendLedgerEvent(prisma, {
    workflowId: policy.merchantId,
    merchantId,
    actorType: "MERCHANT_USER",
    actionType: "MERCHANT_POLICY_UPDATED",
    conciseReason: `Merchant policy updated to version ${policy.policyVersion}.`,
    relatedEntityType: "MerchantPolicy",
    relatedEntityId: merchantId,
    metadata: {
      previousPolicyVersion: before.policyVersion,
      newPolicyVersion: policy.policyVersion,
      changes: update,
    },
  });

  return toMerchantPolicyDTO(policy);
}

export function getMerchantStats(prisma: PrismaClient, merchantId: string) {
  return computeMerchantStats(prisma, merchantId);
}
