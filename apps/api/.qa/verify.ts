import { PrismaClient } from "@prisma/client";
import { verifyWorkflowLedger } from "../src/modules/audit/ledger.js";
const p = new PrismaClient();
const wf = await p.agentAction.findMany({ distinct: ["workflowId"], select: { workflowId: true }, take: 500 });
let bad = 0, ok = 0;
for (const w of wf) {
  const r = await verifyWorkflowLedger(p, w.workflowId);
  if (r.valid) ok++; else { bad++; console.log("BROKEN", w.workflowId, "at", r.brokenAtSequence); }
}
console.log(`ledger chains: ${ok} valid, ${bad} broken (of ${wf.length})`);
await p.$disconnect();
