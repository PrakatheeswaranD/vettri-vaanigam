import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, setToken, subscribeToken } from "./auth-storage";

describe("auth token storage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearToken();
  });

  it("keeps the active session in memory when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });

    setToken("session-token");

    expect(getToken()).toBe("session-token");
  });

  it("clears both persistent and in-memory session state", () => {
    setToken("session-token");
    clearToken();

    expect(getToken()).toBeNull();
  });

  it("synchronizes the memory fallback when another tab logs out", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    setToken("session-token");
    const unsubscribe = subscribeToken(() => undefined);

    window.dispatchEvent(new StorageEvent("storage", { key: "razorgrowth.session.token", newValue: null }));

    expect(getToken()).toBeNull();
    unsubscribe();
  });
});
