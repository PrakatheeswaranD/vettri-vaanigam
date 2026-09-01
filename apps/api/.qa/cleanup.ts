import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const prod = await p.product.findFirst({ where: { name: "QA Audit Test Runner" }, select: { id: true } });
if (prod) {
  await p.agentAction.deleteMany({ where: { relatedEntityType: "Product", relatedEntityId: prod.id } });
  await p.product.delete({ where: { id: prod.id } });
  console.log("removed QA test product");
}
console.log("products now:", await p.product.count());
await p.$disconnect();
