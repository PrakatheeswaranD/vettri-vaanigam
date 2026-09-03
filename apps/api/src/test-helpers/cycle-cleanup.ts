/**
 * Undoes what an autonomous cycle wrote, so one test file cannot starve
 * another.
 *
 * WHY THIS IS NEEDED
 *
 * `runAutonomousCycle` is a heavyweight state mutator: it creates real
 * `GrowthActionProposal` rows, and the recovery-attempt ceiling is counted
 * as RECOVERY proposals per source order. A test file that runs several
 * cycles therefore exhausts that ceiling on the shared demo merchant — and
 * `recovery.test.ts`, which runs later and needs a recoverable order, then
 * fails for a reason that has nothing to do with recovery.
 *
 * That failure was real: the suite passed on a freshly seeded database and
 * failed on one the cycle tests had already worked. CI reseeds every run so
 * it never saw it; a developer re-running locally did.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Reset the database, or delete rows the test did not create. It removes
 * exactly the proposals whose ids the cycle reported, and the governance
 * rows that hang off them — nothing else. A cleanup broad enough to
 * guarantee isolation by wiping tables would also hide genuine
 * cross-contamination, which is the thing worth knowing about.
 */
import type { PrismaClient } from "@prisma/client";
import type { AgentRunResultDTO } from "@razorgrowth/contracts";

/**
 * Collects the proposal ids a set of cycles produced, then removes them.
 *
 * Deletion order follows the foreign keys inward: authorizations and
 * approvals reference the proposal, policy evaluations reference both.
 */
export function createCycleTracker() {
  const proposalIds = new Set<string>();

  return {
    /** Call with each cycle result as it completes. */
    track(run: AgentRunResultDTO): AgentRunResultDTO {
      for (const step of run.steps) {
        if (step.proposalId) proposalIds.add(step.proposalId);
      }
      return run;
    },

    /**
     * For cycles run by something that does not hand back a run result —
     * the scheduler sweep reports counts, not steps. The caller diffs the
     * proposal ids around the sweep and registers what appeared.
     */
    trackIds(ids: string[]): void {
      for (const id of ids) proposalIds.add(id);
    },

    async cleanup(prisma: PrismaClient): Promise<void> {
      const ids = [...proposalIds];
      if (ids.length === 0) return;

      await prisma.executionAuthorization.deleteMany({ where: { proposalId: { in: ids } } });
      await prisma.approval.deleteMany({ where: { proposalId: { in: ids } } });
      await prisma.policyEvaluation.deleteMany({ where: { proposalId: { in: ids } } });
      await prisma.growthActionProposal.deleteMany({ where: { id: { in: ids } } });
      proposalIds.clear();
    },
  };
}
