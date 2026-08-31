import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export interface RateLimitResult {
  count: number;
  resetAt: number;
  allowed: boolean;
  limit: number;
}

export interface RateLimitStore {
  increment(key: string, limit: number, windowMs: number): Promise<RateLimitResult> | RateLimitResult;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private calls = 0;

  increment(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    if (!this.buckets.has(key) && this.buckets.size >= env.RATE_LIMIT_MAX_BUCKETS) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
      if (this.buckets.size >= env.RATE_LIMIT_MAX_BUCKETS) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest) this.buckets.delete(oldest);
      }
    }

    const existing = this.buckets.get(key);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    this.calls += 1;
    if (this.calls % 500 === 0) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }

    return {
      count: bucket.count,
      resetAt: bucket.resetAt,
      allowed: bucket.count <= limit,
      limit,
    };
  }
}

let activeRateLimitStore: RateLimitStore = new InMemoryRateLimitStore();

export function setRateLimitStore(store: RateLimitStore): void {
  activeRateLimitStore = store;
}

export function getRateLimitStore(): RateLimitStore {
  return activeRateLimitStore;
}

function category(request: FastifyRequest): { name: string; limit: number } | null {
  const path = request.url.split("?", 1)[0] ?? request.url;
  if (path === "/api/v1/auth/login") return { name: "login", limit: env.AUTH_RATE_LIMIT_MAX };
  if (/^\/api\/v1\/agent-gateway\/[^/]+\/intents$/.test(path)) {
    return { name: "gateway", limit: env.PUBLIC_RATE_LIMIT_MAX };
  }
  if (/^\/api\/v1\/agent-gateway\/decisions\/[^/]+\/status$/.test(path)) {
    return { name: "gateway-status", limit: env.PUBLIC_RATE_LIMIT_MAX };
  }
  if (/^\/api\/v1\/acp\/[^/]+\//.test(path)) return { name: "acp", limit: env.PUBLIC_RATE_LIMIT_MAX };
  if (/^\/api\/v1\/x402\/[^/]+\//.test(path)) return { name: "x402", limit: env.PUBLIC_RATE_LIMIT_MAX };
  if (/^\/api\/v1\/uap\/[^/]+\//.test(path)) return { name: "uap", limit: env.PUBLIC_RATE_LIMIT_MAX };
  if (/^\/api\/v1\/ucp\/[^/]+\//.test(path)) return { name: "ucp", limit: env.PUBLIC_RATE_LIMIT_MAX };
  return null;
}

function callerKey(request: FastifyRequest): string {
  return request.ip;
}

/**
 * Public abuse protection hook supporting horizontally distributed cluster stores
 * as well as process-local in-memory fallback.
 */
export function createPublicRateLimitHook(customStore?: RateLimitStore) {
  const store = customStore ?? activeRateLimitStore;

  return async function publicRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const selected = category(request);
    if (!selected) return;

    const now = Date.now();
    const key = `${selected.name}|${callerKey(request)}`;
    const result = await store.increment(key, selected.limit, env.RATE_LIMIT_WINDOW_MS);

    reply.header("x-ratelimit-limit", result.limit);
    reply.header("x-ratelimit-remaining", Math.max(0, result.limit - result.count));
    reply.header("x-ratelimit-reset", Math.ceil(result.resetAt / 1_000));

    if (!result.allowed) {
      reply.header("retry-after", Math.max(1, Math.ceil((result.resetAt - now) / 1_000)));
      throw new AppError("RATE_LIMITED", "Too many requests. Retry after the indicated delay.");
    }
  };
}
