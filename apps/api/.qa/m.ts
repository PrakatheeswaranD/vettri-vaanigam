import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const ms = await p.merchant.findMany({ select: { id:true, name:true, slug:true, createdAt:true, _count:{ select:{ products:true } } }, orderBy:{ createdAt:"asc" } });
for (const m of ms) console.log(`${m.createdAt.toISOString()}  ${m.slug}\t"${m.name}"\tproducts=${m._count.products}`);
console.log("merchants:", ms.length);
await p.$disconnect();
