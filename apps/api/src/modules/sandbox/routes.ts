import type { FastifyInstance } from "fastify";
import { sandboxRunRequestSchema } from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getDemoMerchantId } from "../authorization/demo-context.js";
import { listSandboxPresets, runSandboxAttack } from "./service.js";

/**
 * Break the Agent — TEST/DEMO SANDBOX ONLY (PART 09 §29, §153). Every
 * attack is bounded to the one controlled demo merchant this whole
 * application already operates against; nothing here accepts an
 * arbitrary endpoint/command, and no attack can ever move real money —
 * `runSandboxAttack` only ever calls real, already-existing deterministic
 * validation/policy/eligibility code.
 */
export function registerSandboxRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/sandbox/break-the-agent/presets`, async () => {
    return { presets: listSandboxPresets() };
  });

  app.post(`${prefix}/sandbox/break-the-agent/run`, async (request) => {
    const merchantId = await getDemoMerchantId(prisma);
    const body = sandboxRunRequestSchema.parse(request.body);
    return runSandboxAttack(prisma, merchantId, body.attackId);
  });
}
