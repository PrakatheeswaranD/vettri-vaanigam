import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
await p.buyerSpendingPolicy.update({ where: { merchantId: "ce81d7a4-9ac5-4522-b1dd-8fd3d89eb041" }, data: { dailyLimitMinor: 1000000 } });
console.log(await p.buyerSpendingPolicy.findFirst({ select: { dailyLimitMinor: true, autonomousPurchaseLimitMinor: true } }));
await p.$disconnect();
