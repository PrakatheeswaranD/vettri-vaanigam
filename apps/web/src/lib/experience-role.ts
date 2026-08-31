import { useSyncExternalStore } from "react";

export type ExperienceRole = "customer" | "merchant" | "admin";
const STORAGE_KEY = "razorgrowth.experience.role";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function getExperienceRole(): ExperienceRole {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "customer" || value === "admin" || value === "merchant") return value;
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
  admin: "/admin/overview",
};
