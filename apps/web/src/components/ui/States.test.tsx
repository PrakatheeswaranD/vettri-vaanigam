import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState, ErrorState } from "./States";

describe("EmptyState", () => {
  it("renders the title and description as real product copy, not a blank/loading placeholder", () => {
    render(<EmptyState title="No products have been added yet." description="Try a different search term." />);
    expect(screen.getByText("No products have been added yet.")).toBeInTheDocument();
    expect(screen.getByText("Try a different search term.")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("surfaces the real error message rather than swallowing the failure", () => {
    render(<ErrorState message="Could not load the catalog." />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Could not load the catalog.")).toBeInTheDocument();
  });

  it("invokes onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Network error." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when no onRetry handler is given", () => {
    render(<ErrorState message="Network error." />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
