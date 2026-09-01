import { useSyncExternalStore } from "react";

/**
 * Two roles, deliberately.
 *
 * A platform-admin experience existed and was removed: it was a third door
 * onto a console nobody demoing this product needs, and it diluted the two
 * that carry the actual story — an agent buying, and a merchant governing.
 */
export type ExperienceRole = "customer" | "merchant";
const STORAGE_KEY = "razorgrowth.experience.role";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function getExperienceRole(): ExperienceRole {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "customer" || value === "merchant") return value;
  } catch { /* storage can be unavailable */ }
  return "merchant";
}

export function setExperienceRole(role: ExperienceRole): void {
  try { localStorage.setItem(STORAGE_KEY, role); } catch { /* non-persistent demo session */ }
  notify();
}

export function clearExperienceRole(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing else to clear */ }
  notify();
}

export function useExperienceRole(): ExperienceRole {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
  }, getExperienceRole, () => "merchant");
}

export const ROLE_HOME: Record<ExperienceRole, string> = {
  customer: "/customer/buyer-agent",
  merchant: "/merchant/overview",
};
