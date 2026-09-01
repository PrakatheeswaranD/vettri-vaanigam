import { PrismaClient } from "@prisma/client";
const p: any = new PrismaClient();
const models = ["merchant","merchantUser","product","productVariant","inventory","customer","order","orderItem","payment","cart","checkoutSession","agentActionLedger","decisionRecord","approvalRequest","growthOpportunity","campaign","catalogSnapshot","refund","returnRequest","fulfillment","dispute","buyerSpendingPolicy","agentIdentity","recoveryAction"];
for (const m of models) {
  try { console.log(m.padEnd(22), await p[m].count()); } catch (e:any) { console.log(m.padEnd(22), "N/A"); }
}
await p.$disconnect();
