import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const v = await p.productVariant.findFirst({ where: { sku: "MERIDIANSUMMITTRAIL-UK9" }, select: { id:true, sku:true, priceMinor:true, costMinor:true, product:{select:{name:true, merchantId:true}} } });
console.log(v);
const nulls = await p.productVariant.count({ where: { costMinor: null } });
console.log("variants with null cost:", nulls, "of", await p.productVariant.count());
await p.$disconnect();
