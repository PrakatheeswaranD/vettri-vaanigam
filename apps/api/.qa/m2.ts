import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
console.log("DATABASE_URL:", process.env.DATABASE_URL);
const ms = await p.merchant.findMany({ select: { name:true, slug:true, status:true }, orderBy:{ name:"asc" } });
console.log(ms);
await p.$disconnect();
