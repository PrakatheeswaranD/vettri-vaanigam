import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.decisionRecord.findMany({ where: { externalAgentId: "customer-buyer-agent" }, orderBy: { createdAt: "desc" }, take: 15, select: { id:true, outcome:true, settlementStatus:true, computedTotalMinor:true, negotiationStatus:true, internalOrderId:true, internalPaymentId:true, stepUpDecidedAt:true, createdAt:true } });
for (const r of rows) console.log(r.createdAt.toISOString(), r.settlementStatus?.padEnd(16), "total="+r.computedTotalMinor, "neg="+r.negotiationStatus, "order="+(r.internalOrderId?"Y":"-"), "pay="+(r.internalPaymentId?"Y":"-"), "stepUp="+(r.stepUpDecidedAt?"Y":"-"));
await p.$disconnect();
