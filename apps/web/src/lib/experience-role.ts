import { useSyncExternalStore } from "react";

/**
 * Two experiences carry the story — an agent buying, and a merchant
 * governing — and a third that exists only because the platform operator
 * has to land somewhere.
 *
 * A full platform-admin EXPERIENCE was removed once, correctly: a parallel
 * nav tree nobody demos diluted the two that matter. What survived that
 * removal was a `PLATFORM_ADMIN` role that can still be provisioned and
 * still log in, against nine implemented and RBAC-gated `/admin/*`
 * endpoints with nothing rendering them — so the operator signed in and
 * landed on a merchant console where every request was refused.
 *
 * `admin` here is one page, not a third console. It is the smallest thing
 * that makes an existing role honest.
 */
export type ExperienceRole = "customer" | "merchant" | "admin";
const STORAGE_KEY = "razorgrowth.experience.role";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function getExperienceRole(): ExperienceRole {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "customer" || value === "merchant" || value === "admin") return value;
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
  admin: "/admin/platform",
};
