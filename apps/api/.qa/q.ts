import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const vs = await p.productVariant.findMany({
  where: { active: true, product: { category: "Running Shoes" } },
  select: { sku: true, priceMinor: true, attributes: true, inventory: { select: { availableQuantity: true } } },
  orderBy: { sku: "asc" },
});
for (const v of vs) {
  const a = v.attributes as any;
  console.log(`${v.sku}\t${v.priceMinor/100}\tsize=${a?.size}\tcolor=${a?.color ?? "-"}\tinv=${v.inventory?.availableQuantity ?? "UNKNOWN"}`);
}
const uk9 = vs.filter(v => (v.attributes as any)?.size === "UK9");
console.log("total:", vs.length, "UK9:", uk9.length, "UK9+Black:", uk9.filter(v=>(v.attributes as any)?.color==="Black").length, "UK9+Black+<=6000:", uk9.filter(v=>(v.attributes as any)?.color==="Black" && v.priceMinor<=600000).length);
await p.$disconnect();
