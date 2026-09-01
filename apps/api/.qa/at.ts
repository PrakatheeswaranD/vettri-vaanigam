import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.agentAction.groupBy({ by: ["actionType"], _count: { _all: true }, orderBy: { _count: { actionType: "desc" } } });
for (const r of rows) console.log(String(r._count._all).padStart(5), r.actionType);
await p.$disconnect();
