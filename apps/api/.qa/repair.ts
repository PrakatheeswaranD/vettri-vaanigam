import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
// Only rows that provably never created an order or a payment: the
// execution transaction rolled back, so nothing was ever charged.
const stuck = await p.decisionRecord.findMany({
  where: { externalAgentId: "customer-buyer-agent", settlementStatus: "UNKNOWN", internalOrderId: null, internalPaymentId: null },
  select: { id: true, computedTotalMinor: true },
});
console.log("rolled-back rows misfiled as UNKNOWN:", stuck.length);
for (const r of stuck) {
  await p.decisionRecord.update({ where: { id: r.id }, data: { settlementStatus: "FAILED" } });
  console.log("  ->FAILED", r.id, r.computedTotalMinor);
}
await p.$disconnect();
