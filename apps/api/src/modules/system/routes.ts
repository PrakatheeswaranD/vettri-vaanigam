/**
 * Liveness vs readiness (PART 01 §25, §26).
 *
 * `/health` answers "is the process up?" — no dependency checks, so it
 * must never itself become slow or fail because a downstream is unwell.
 * `/system/readiness` answers "can this instance actually serve traffic?"
 * by checking the database. Neither ever exposes connection strings,
 * secrets, or stack traces.
 */
import type { FastifyInstance } from "fastify";
import type {
  ConnectedSystemsDTO,
  HealthResponseDTO,
  SystemCapabilitiesDTO,
  SystemReadinessResponseDTO,
} from "@razorgrowth/contracts";
import { prisma } from "../../db/client.js";
import { getAuthenticatedMerchantId } from "../authorization/demo-context.js";
import { getConnectedSystems, getSystemCapabilities } from "./service.js";

export function registerSystemRoutes(app: FastifyInstance, prefix: string): void {
  app.get(`${prefix}/health`, async (): Promise<HealthResponseDTO> => {
    return { status: "ok", service: "razorgrowth-api" };
  });

  app.get(`${prefix}/system/capabilities`, async (request): Promise<SystemCapabilitiesDTO> => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getSystemCapabilities(prisma, merchantId);
  });

  app.get(`${prefix}/system/connected-systems`, async (request): Promise<ConnectedSystemsDTO> => {
    const merchantId = getAuthenticatedMerchantId(request);
    return getConnectedSystems(prisma, merchantId);
  });

  app.get(`${prefix}/system/readiness`, async (_request, reply): Promise<SystemReadinessResponseDTO> => {
    let database: "ok" | "unreachable" = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "unreachable";
    }

    const status = database === "ok" ? "ready" : "degraded";
    if (status === "degraded") {
      reply.status(503);
    }
    return { status, checks: { api: "ok", database } };
  });
}
