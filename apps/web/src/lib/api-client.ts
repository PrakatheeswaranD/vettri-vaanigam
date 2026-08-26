/**
 * Centralized, typed API access (PART 01 §49). No component makes a raw
 * `fetch` call — everything goes through `apiGet`, whose only job is to
 * hit `/api/v1/*` and surface the server's safe error envelope as a typed
 * `ApiError` instead of a generic network error.
 */
import type { ApiErrorDTO } from "@razorgrowth/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

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
  const response = await fetch(buildUrl(path, params));
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorDTO | null;
    if (body?.error) {
      throw new ApiError(response.status, body);
    }
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorDTO | null;
    if (errorBody?.error) {
      throw new ApiError(response.status, errorBody);
    }
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorDTO | null;
    if (errorBody?.error) {
      throw new ApiError(response.status, errorBody);
    }
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
