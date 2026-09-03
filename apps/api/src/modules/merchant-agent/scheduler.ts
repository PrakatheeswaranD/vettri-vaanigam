/**
 * The "continuously" half of the Merchant Agent.
 *
 * WHY THIS WAS DEFERRED, AND WHY IT IS HERE NOW
 *
 * Part 3 built the cycle and left it merchant-triggered, on the grounds
 * that a scheduler which moves money while nobody is watching is a product
 * decision the build had not asked merchants to agree to. That reasoning
 * still holds — so this does not remove the decision, it hands it to the
 * merchant.
 *
 * TWO SWITCHES, BOTH OFF BY DEFAULT
 *
 *   AGENT_SCHEDULER_ENABLED     the operator's. Starting an API against a
 *                               connected database must never begin
 *                               running cycles by surprise — the same rule
 *                               `startRetentionSweeper` already applies to
 *                               deleting rows.
 *   autonomousRunsEnabled       the merchant's, per merchant, default
 *                               false. Nobody is opted in by deployment.
 *
 * Both must be true before a single cycle runs unattended.
 *
 * WHAT THIS DOES NOT RELAX
 *
 * Nothing. A scheduled cycle is the same `runAutonomousCycle` a merchant
 * triggers by hand: the same policy engine, the same auto-approval
 * ceilings, the same refusal to execute anything outside them. Unattended
 * does not mean unbounded — it means the merchant is not present to press
 * the button, not that the button does more.
 */
import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import { runAutonomousCycle } from "./autonomous-run-service.js";

/**
 * Runs one cycle for every merchant that has opted in.
 *
 * Sequential across merchants on purpose: each cycle reconciles payment
 * state with the provider and writes governance rows, and running several
 * merchants' cycles concurrently would put avoidable load on a provider
 * for no gain in a background job nobody is waiting on.
 */
export async function runScheduledCycles(prisma: PrismaClient): Promise<{ merchants: number; executed: number; failed: number }> {
  const optedIn = await prisma.merchantGrowthConfig.findMany({
    where: { autonomousRunsEnabled: true, growthActionsEnabled: true },
    select: { merchantId: true },
  });

  let executed = 0;
  let failed = 0;

  for (const { merchantId } of optedIn) {
    try {
      // The one caller for which nobody is watching, and the reason the
      // merchant's daily ceiling exists.
      const run = await runAutonomousCycle(prisma, merchantId, { unattended: true });
      executed += run.counts.executed;
      failed += run.counts.failed;
      logger.info(
        { event: "merchant_agent.scheduled_cycle", merchantId, workflowId: run.workflowId, ...run.counts },
        "Scheduled autonomous cycle completed",
      );
    } catch (error) {
      // One merchant's cycle failing must never stop the others, and must
      // never take the process down. The failure is recorded and the loop
      // continues — the same posture the cycle itself takes toward one
      // opportunity failing.
      failed += 1;
      logger.error(
        { event: "merchant_agent.scheduled_cycle_failed", merchantId, err: error },
        "Scheduled autonomous cycle failed",
      );
    }
  }

  return { merchants: optedIn.length, executed, failed };
}

export function startAgentScheduler(prisma: PrismaClient): () => void {
  if (!env.AGENT_SCHEDULER_ENABLED) return () => {};

  let running = false;
  const tick = () => {
    // A cycle can outlast its own interval on a large failure backlog.
    // Overlapping runs would race on the per-order recovery-attempt count
    // the policy engine reads, so a tick that arrives while one is in
    // flight is skipped rather than queued.
    if (running) {
      logger.warn({ event: "merchant_agent.scheduled_cycle_skipped" }, "Previous scheduled cycle still running; skipping this tick");
      return;
    }
    running = true;
    void runScheduledCycles(prisma)
      .then((result) => {
        if (result.merchants > 0) {
          logger.info({ event: "merchant_agent.scheduler_swept", ...result }, "Scheduled cycles swept");
        }
      })
      .catch((error) => logger.error({ event: "merchant_agent.scheduler_failed", err: error }, "Scheduler sweep failed"))
      .finally(() => {
        running = false;
      });
  };

  // Deliberately no immediate run on boot. A deploy or a restart is not a
  // reason to act on a merchant's catalogue, and a crash-loop would
  // otherwise fire a cycle on every restart.
  const timer = setInterval(tick, env.AGENT_SCHEDULER_INTERVAL_MS);
  timer.unref();
  logger.info(
    { event: "merchant_agent.scheduler_started", intervalMs: env.AGENT_SCHEDULER_INTERVAL_MS },
    "Merchant Agent scheduler started; only merchants who opted in will run",
  );
  return () => clearInterval(timer);
}
