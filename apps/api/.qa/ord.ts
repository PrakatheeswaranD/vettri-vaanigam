import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const o = await p.order.findUnique({ where: { id: "ba3a864a-20df-46ba-85a9-6c400c0a90be" }, include: { items: true, payments: { select: { id:true, state:true, amountMinor:true, provider:true, providerOrderId:true } } } });
console.log("order total:", o?.totalAmountMinor, o?.currency, "status:", o?.status);
for (const i of o?.items ?? []) console.log("  item:", i.productNameSnapshot, "unit=", i.unitPriceMinor, "qty=", i.quantity, "disc=", i.lineDiscountMinor, "lineTotal=", i.lineTotalMinor);
console.log("payments:", o?.payments);
await p.$disconnect();
