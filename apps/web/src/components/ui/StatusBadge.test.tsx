import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentActionStatusBadge, PaymentStateBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a text label for a known payment state, not color alone (PART 01 §73)", () => {
    render(<PaymentStateBadge state="CAPTURED" />);
    expect(screen.getByText("Captured")).toBeInTheDocument();
  });

  it("falls back to the raw value for an unrecognized status instead of rendering blank", () => {
    render(<AgentActionStatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText("SOMETHING_NEW")).toBeInTheDocument();
  });
});
