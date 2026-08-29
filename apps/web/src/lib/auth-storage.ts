/**
 * Session token storage (PART 10 §1). A thin, reactive wrapper around
 * `localStorage` — the token itself is an opaque, server-issued, hashed-
 * server-side bearer credential (never a JWT the client could decode or
 * forge), so storing the raw string is exactly what the server expects
 * back in an `Authorization: Bearer <token>` header. `subscribe` lets
 * React components (`useAuthToken`) re-render the instant the token is
 * set or cleared, including by another browser tab (`storage` event).
 */
const STORAGE_KEY = "razorgrowth.session.token";

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private browsing, quota) — session just won't
    // persist across reloads; the in-memory app state still works.
  }
  notify();
}

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See setToken.
  }
  notify();
}

export function subscribeToken(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
