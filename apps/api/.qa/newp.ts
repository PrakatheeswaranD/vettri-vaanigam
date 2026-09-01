import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const prod = await p.product.findFirst({ where: { name: "QA Audit Test Runner" }, include: { variants: { include: { inventory: true } } } });
console.log(JSON.stringify(prod, null, 2));
console.log("total products:", await p.product.count());
await p.$disconnect();
