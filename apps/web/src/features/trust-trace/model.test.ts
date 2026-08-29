import { describe, expect, it } from "vitest";
import type { WorkflowTraceDTO, WorkflowTraceStepDTO } from "@razorgrowth/contracts";
import { buildTrustTraceModel } from "./model";

function step(overrides: Partial<WorkflowTraceStepDTO> & Pick<WorkflowTraceStepDTO, "sequence" | "actor" | "event">): WorkflowTraceStepDTO {
  return {
    status: "EXECUTED",
    conciseReason: `${overrides.event} occurred`,
    timestamp: new Date(2026, 0, 1, 10, 0, overrides.sequence).toISOString(),
    relatedEntityType: null,
    relatedEntityId: null,
    ...overrides,
  };
}

function trace(steps: WorkflowTraceStepDTO[], overrides: Partial<WorkflowTraceDTO> = {}): WorkflowTraceDTO {
  return {
    workflowId: "11111111-1111-1111-1111-111111111111",
    startedAt: steps[0]?.timestamp ?? null,
    completedAt: steps[steps.length - 1]?.timestamp ?? null,
    steps,
    financialOutcome: "PENDING",
    ledgerIntegrity: { valid: true, eventCount: steps.length, brokenAtSequence: null },
    growthEffect: null,
    ...overrides,
  };
}

describe("buildTrustTraceModel", () => {
  it("maps a full ALLOW-path workflow to OK stages in the fixed leading order", () => {
    const model = buildTrustTraceModel(
      trace([
        step({ sequence: 1, actor: "MERCHANT_AGENT", event: "GROWTH_PROPOSAL_CREATED" }),
        step({ sequence: 2, actor: "POLICY_ENGINE", event: "POLICY_ALLOWED" }),
        step({ sequence: 3, actor: "SYSTEM", event: "EXECUTION_AUTHORIZATION_ISSUED" }),
        step({ sequence: 4, actor: "COMMERCE", event: "ORDER_CREATED" }),
      ]),
    );

    const ids = model.stages.map((s) => s.id);
    expect(ids).toEqual(["intent", "proposal", "policy", "approval", "authorization", "commerce"]);

    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(byId.intent!.status).toBe("NOT_REACHED");
    expect(byId.proposal!.status).toBe("OK");
    expect(byId.policy!.status).toBe("OK");
    expect(byId.approval!.status).toBe("NOT_REACHED");
    expect(byId.authorization!.status).toBe("OK");
    expect(byId.commerce!.status).toBe("OK");
  });

  it("stops the chain at a policy DENY — approval/authorization/commerce never reached", () => {
    const model = buildTrustTraceModel(
      trace([
        step({ sequence: 1, actor: "MERCHANT_AGENT", event: "GROWTH_PROPOSAL_CREATED" }),
        step({ sequence: 2, actor: "POLICY_ENGINE", event: "POLICY_DENIED" }),
      ]),
    );
    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(byId.policy!.status).toBe("BLOCKED");
    expect(byId.approval!.status).toBe("NOT_REACHED");
    expect(byId.authorization!.status).toBe("NOT_REACHED");
    expect(byId.commerce!.status).toBe("NOT_REACHED");
  });

  it("marks an approval-required, still-pending proposal as ATTENTION, not OK or BLOCKED", () => {
    const model = buildTrustTraceModel(
      trace([
        step({ sequence: 1, actor: "MERCHANT_AGENT", event: "GROWTH_PROPOSAL_CREATED" }),
        step({ sequence: 2, actor: "POLICY_ENGINE", event: "POLICY_EVALUATED" }),
        step({ sequence: 3, actor: "SYSTEM", event: "APPROVAL_REQUESTED" }),
      ]),
    );
    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(byId.policy!.status).toBe("ATTENTION");
    expect(byId.approval!.status).toBe("ATTENTION");
    expect(byId.authorization!.status).toBe("NOT_REACHED");
  });

  it("resolves approval to OK once APPROVED follows REQUESTED in the same stage", () => {
    const model = buildTrustTraceModel(
      trace([
        step({ sequence: 1, actor: "SYSTEM", event: "APPROVAL_REQUESTED" }),
        step({ sequence: 2, actor: "MERCHANT_USER", event: "APPROVAL_APPROVED" }),
      ]),
    );
    const byId = Object.fromEntries(model.stages.map((s) => [s.id, s]));
    expect(byId.approval!.status).toBe("OK");
    expect(byId.approval!.actorClass).toBe("HUMAN");
  });

  it("segments a failure-then-recovery-then-capture workflow into Payment Attempt 1 (FAILED) -> Recovery (OK) -> Payment Attempt 2 (OK)", () => {
    const model = buildTrustTraceModel(
      trace(
        [
          step({ sequence: 1, actor: "MERCHANT_AGENT", event: "GROWTH_PROPOSAL_CREATED" }),
          step({ sequence: 2, actor: "POLICY_ENGINE", event: "POLICY_ALLOWED" }),
          step({ sequence: 3, actor: "SYSTEM", event: "EXECUTION_AUTHORIZATION_ISSUED" }),
          step({ sequence: 4, actor: "COMMERCE", event: "ORDER_CREATED" }),
          step({ sequence: 5, actor: "PAYMENT_SYSTEM", event: "PAYMENT_RECORD_CREATED" }),
          step({ sequence: 6, actor: "RAZORPAY", event: "PAYMENT_FAILED" }),
          step({ sequence: 7, actor: "SYSTEM", event: "RECOVERY_ELIGIBILITY_EVALUATED" }),
          step({ sequence: 8, actor: "MERCHANT_AGENT", event: "RECOVERY_PROPOSAL_CREATED" }),
          step({ sequence: 9, actor: "SYSTEM", event: "RECOVERY_ATTEMPT_CREATED" }),
          step({ sequence: 10, actor: "PAYMENT_SYSTEM", event: "PAYMENT_RECORD_CREATED" }),
          step({ sequence: 11, actor: "RAZORPAY", event: "PAYMENT_CAPTURED" }),
        ],
        { financialOutcome: "RECOVERED" },
      ),
    );

    const dynamicStages = model.stages.slice(6); // after the 6 fixed leading stages
    expect(dynamicStages.map((s) => s.id)).toEqual(["payment-1", "recovery-1", "payment-2"]);
    expect(dynamicStages[0]!.label).toBe("Payment Attempt 1");
    expect(dynamicStages[0]!.status).toBe("FAILED");
    expect(dynamicStages[1]!.label).toBe("Recovery");
    expect(dynamicStages[1]!.status).toBe("OK");
    expect(dynamicStages[2]!.label).toBe("Payment Attempt 2");
    expect(dynamicStages[2]!.status).toBe("OK");
    expect(model.financialOutcome).toBe("RECOVERED");
  });

  it("surfaces an unrecognized actionType rather than silently dropping it", () => {
    const model = buildTrustTraceModel(trace([step({ sequence: 1, actor: "SYSTEM", event: "SOME_FUTURE_EVENT_TYPE" })]));
    expect(model.unrecognizedEvents).toHaveLength(1);
    expect(model.unrecognizedEvents[0]!.event).toBe("SOME_FUTURE_EVENT_TYPE");
    // and no fixed stage should silently absorb it
    expect(model.stages.every((s) => s.events.every((e) => e.event !== "SOME_FUTURE_EVENT_TYPE"))).toBe(true);
  });

  it("is robust to out-of-order source steps — sorts by sequence before segmenting", () => {
    const model = buildTrustTraceModel(
      trace([
        step({ sequence: 3, actor: "RAZORPAY", event: "PAYMENT_FAILED" }),
        step({ sequence: 1, actor: "COMMERCE", event: "ORDER_CREATED" }),
        step({ sequence: 5, actor: "RAZORPAY", event: "PAYMENT_CAPTURED" }),
        step({ sequence: 2, actor: "PAYMENT_SYSTEM", event: "PAYMENT_RECORD_CREATED" }),
        step({ sequence: 4, actor: "SYSTEM", event: "RECOVERY_ATTEMPT_CREATED" }),
      ]),
    );
    const dynamicStages = model.stages.slice(6);
    expect(dynamicStages.map((s) => s.id)).toEqual(["payment-1", "recovery-1", "payment-2"]);
    expect(dynamicStages[0]!.status).toBe("FAILED");
    expect(dynamicStages[2]!.status).toBe("OK");
  });

  it("passes through the real ledger integrity result unchanged", () => {
    const model = buildTrustTraceModel(trace([], { ledgerIntegrity: { valid: false, eventCount: 3, brokenAtSequence: 2 } }));
    expect(model.ledgerIntegrity).toEqual({ valid: false, eventCount: 3, brokenAtSequence: 2 });
  });

  it("marks every fixed stage NOT_REACHED for an empty workflow", () => {
    const model = buildTrustTraceModel(trace([]));
    expect(model.stages).toHaveLength(6);
    expect(model.stages.every((s) => s.status === "NOT_REACHED")).toBe(true);
  });

  it("attributes a payment stage to the PROVIDER even though our own code wrote the final row", () => {
    // This mirrors what the ledger actually records: the provider webhook
    // arrives first, and `PAYMENT_CAPTURED` is written afterwards under
    // PAYMENT_SYSTEM because our code persisted it. Taking the LAST
    // event's actor would label the stage "Deterministic" and quietly
    // claim this system decided the payment succeeded — the opposite of
    // the guarantee. Provider evidence has to win.
    const model = buildTrustTraceModel(
      trace([
        step({ sequence: 1, actor: "MERCHANT_AGENT", event: "GROWTH_PROPOSAL_CREATED" }),
        step({ sequence: 2, actor: "RAZORPAY", event: "WEBHOOK_RECEIVED" }),
        step({ sequence: 3, actor: "SYSTEM", event: "WEBHOOK_SIGNATURE_VERIFIED" }),
        step({ sequence: 4, actor: "PAYMENT_SYSTEM", event: "PAYMENT_CAPTURED" }),
      ]),
    );

    const payment = model.stages.find((s) => s.id === "payment-1");
    expect(payment).toBeDefined();
    expect(payment!.actorClass).toBe("PROVIDER");
    expect(payment!.status).toBe("OK");
  });

  it("still uses the last event's actor when no provider evidence is present", () => {
    const model = buildTrustTraceModel(
      trace([step({ sequence: 1, actor: "POLICY_ENGINE", event: "POLICY_ALLOWED" })]),
    );
    expect(model.stages.find((s) => s.id === "policy")!.actorClass).toBe("DETERMINISTIC");
  });
});
