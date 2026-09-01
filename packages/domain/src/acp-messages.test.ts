import { describe, it, expect } from "vitest";
import { buildAcpMessages, decisionNeedsAcpMessages, type DecisionForMessages } from "./acp-messages.js";
import { GATEWAY_REASON_CODES } from "./agent-gateway-policy.js";
import { MANDATE_REJECTION_CODES } from "./spend-mandate.js";

function decision(overrides: Partial<DecisionForMessages> = {}): DecisionForMessages {
  return {
    outcome: "DECLINE",
    reasonCode: "CATEGORY_BLOCKED",
    explanation: "You have blocked this category from autonomous agent purchases.",
    ...overrides,
  };
}

describe("ACP structured messages", () => {
  it("says nothing on the happy path", () => {
    expect(buildAcpMessages(decision({ outcome: "AUTO_APPROVE" }))).toEqual([]);
    expect(decisionNeedsAcpMessages("AUTO_APPROVE")).toBe(false);
  });

  /** The whole point of Feature D: the step-up is a case the protocol
   * already had a word for. */
  it("uses the protocol's own approval_required code for a step-up", () => {
    const messages = buildAcpMessages(
      decision({ outcome: "STEP_UP", reasonCode: "UNKNOWN_AGENT_CEILING_EXCEEDED" }),
    );
    const error = messages.find((m) => m.type === "error");
    expect(error?.code).toBe("approval_required");
    expect(error?.content_type).toBe("plain");
  });

  it("tells a caller when the fix is theirs to make", () => {
    const messages = buildAcpMessages(decision({ reasonCode: "MANDATE_EXPIRED" }));
    expect(messages[0]!.code).toBe("intervention_required");
    expect(messages[0]!.content).toContain("fresh mandate");
  });

  /** A blocked category is not something the agent can fix by retrying —
   * only the merchant can change it. */
  it("does not tell a caller to intervene when nothing it does would help", () => {
    expect(buildAcpMessages(decision({ reasonCode: "CATEGORY_BLOCKED" }))[0]!.code).toBe("approval_required");
  });

  it("passes the step-up link through as info, not as an error", () => {
    const messages = buildAcpMessages(
      decision({ outcome: "STEP_UP", reasonCode: "KNOWN_AGENT_CEILING_EXCEEDED", stepUpUrl: "https://rzp.io/i/abc" }),
    );
    const link = messages.find((m) => m.content.includes("https://rzp.io/i/abc"));
    expect(link?.type).toBe("info");
    expect(link?.code).toBeUndefined();
  });

  it("tells the agent a step-up is not a refusal", () => {
    const messages = buildAcpMessages(decision({ outcome: "STEP_UP", reasonCode: "UNKNOWN_AGENT_CEILING_EXCEEDED" }));
    expect(messages.some((m) => m.content.includes("not a refusal"))).toBe(true);
  });

  it("always carries the merchant's own sentence, never only a code", () => {
    const explanation = "A very specific sentence about this exact order.";
    for (const outcome of ["STEP_UP", "DECLINE"] as const) {
      const messages = buildAcpMessages(decision({ outcome, explanation }));
      expect(messages[0]!.content).toContain(explanation);
    }
  });

  /**
   * The property that keeps this honest protocol usage rather than an
   * extension wearing the protocol's name: an ACP client switching on
   * `code` must never meet a value ACP does not define.
   */
  it("never emits a code outside ACP's own enum, for ANY reason code", () => {
    const everyReason = [...GATEWAY_REASON_CODES, ...MANDATE_REJECTION_CODES, "SOMETHING_ADDED_LATER"];
    for (const reasonCode of everyReason) {
      for (const outcome of ["STEP_UP", "DECLINE"] as const) {
        for (const message of buildAcpMessages(decision({ outcome, reasonCode }))) {
          if (message.type === "error") {
            expect(["approval_required", "intervention_required"]).toContain(message.code);
          } else {
            expect(message.code).toBeUndefined();
          }
        }
      }
    }
  });

  it("produces at least one error for every non-approval outcome", () => {
    for (const reasonCode of [...GATEWAY_REASON_CODES, ...MANDATE_REJECTION_CODES]) {
      for (const outcome of ["STEP_UP", "DECLINE"] as const) {
        const messages = buildAcpMessages(decision({ outcome, reasonCode }));
        expect(messages.some((m) => m.type === "error")).toBe(true);
      }
    }
  });

  /** An unrecognised reason must still produce something a human can read,
   * not an empty string or the literal code. */
  it("degrades to the merchant's sentence for a reason it has no guidance for", () => {
    const messages = buildAcpMessages(
      decision({ reasonCode: "A_CODE_ADDED_AFTER_THIS_FILE_WAS_WRITTEN", explanation: "Something went wrong here." }),
    );
    expect(messages[0]!.content).toBe("Something went wrong here.");
    expect(messages[0]!.content.length).toBeGreaterThan(10);
  });
});
