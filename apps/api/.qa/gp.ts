import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
console.log(JSON.stringify(await p.agentGatewayPolicy.findFirst(), null, 2));
await p.$disconnect();
