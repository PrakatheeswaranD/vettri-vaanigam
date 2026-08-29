/**
 * Opaque, server-side, revocable sessions (PART 10 §1) — deliberately
 * not a JWT. The client holds only a random bearer token; this module
 * stores only a SHA-256 hash of it (never the raw token), so a leaked
 * database dump alone cannot be replayed as a valid session. Revoking
 * access is a `DELETE`, not "wait for the token to expire."
 */
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(prisma: PrismaClient, merchantUserId: string): Promise<CreatedSession> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + env.SESSION_VALIDITY_HOURS * 60 * 60 * 1000);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), merchantUserId, expiresAt },
  });
  return { token, expiresAt };
}

export interface AuthenticatedSession {
  merchantUserId: string;
  merchantId: string;
  role: string;
  email: string;
}

/** Returns `null` for a missing, invalid, or expired token — the caller
 * (the auth middleware) decides how to respond; this function never
 * throws for an ordinary "not authenticated" outcome. */
export async function resolveSession(prisma: PrismaClient, token: string): Promise<AuthenticatedSession | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { merchantUser: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return {
    merchantUserId: session.merchantUser.id,
    merchantId: session.merchantUser.merchantId,
    role: session.merchantUser.role,
    email: session.merchantUser.email,
  };
}

export async function revokeSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
