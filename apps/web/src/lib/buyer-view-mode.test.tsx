import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useBuyerViewMode } from "./buyer-view-mode";

describe("Vettri Vaanigam view preference", () => {
  beforeEach(() => sessionStorage.clear());

  it("migrates an existing trace preference to the new brand key", () => {
    sessionStorage.setItem("vaanigam.buyerViewMode", "trace");
    const { result } = renderHook(() => useBuyerViewMode());
    expect(result.current[0]).toBe("trace");
    expect(sessionStorage.getItem("vettri_vaanigam.buyerViewMode")).toBe("trace");
    expect(sessionStorage.getItem("vaanigam.buyerViewMode")).toBeNull();
  });

  it("preserves a newer preference when both keys exist", () => {
    sessionStorage.setItem("vaanigam.buyerViewMode", "trace");
    sessionStorage.setItem("vettri_vaanigam.buyerViewMode", "buyer");
    const { result } = renderHook(() => useBuyerViewMode());
    expect(result.current[0]).toBe("buyer");
  });

  it("writes changes only under the current brand", () => {
    const { result } = renderHook(() => useBuyerViewMode());
    act(() => result.current[1]("trace"));
    expect(sessionStorage.getItem("vettri_vaanigam.buyerViewMode")).toBe("trace");
    expect(sessionStorage.getItem("vaanigam.buyerViewMode")).toBeNull();
  });
});
