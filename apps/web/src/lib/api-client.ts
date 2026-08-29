/**
 * Centralized, typed API access (PART 01 §49). No component makes a raw
 * `fetch` call — everything goes through `apiGet`, whose only job is to
 * hit `/api/v1/*` and surface the server's safe error envelope as a typed
 * `ApiError` instead of a generic network error.
 */
import type { ApiErrorDTO } from "@razorgrowth/contracts";
import { clearToken, getToken } from "./auth-storage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** A 401 means the session is gone (never logged in, expired, or
 * revoked) — clear it client-side so `RequireAuth` immediately redirects
 * to `/login`, rather than looping on the same failed request. */
async function toApiError(response: Response): Promise<ApiError | Error> {
  const body = (await response.json().catch(() => null)) as ApiErrorDTO | null;
  if (response.status === 401) clearToken();
  if (body?.error) return new ApiError(response.status, body);
  return new Error(`Request failed with status ${response.status}`);
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;

  constructor(status: number, body: ApiErrorDTO) {
    super(body.error.message);
    this.name = "ApiError";
    this.code = body.error.code;
    this.status = status;
    this.requestId = body.error.requestId;
  }
}

export interface QueryParams {
  [key: string]: string | number | undefined;
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await fetch(buildUrl(path, params), { headers: authHeaders() });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json", ...authHeaders() } : authHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}
