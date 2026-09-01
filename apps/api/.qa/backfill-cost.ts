import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.productVariant.findMany({ where: { costMinor: null }, select: { id: true, priceMinor: true } });
console.log("variants missing cost:", rows.length);
let n = 0;
for (const r of rows) {
  await p.productVariant.update({ where: { id: r.id }, data: { costMinor: Math.floor(r.priceMinor * 0.65) } });
  n++;
}
console.log("backfilled:", n);
console.log("remaining null:", await p.productVariant.count({ where: { costMinor: null } }));
await p.$disconnect();
