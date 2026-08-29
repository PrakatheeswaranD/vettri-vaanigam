import type { PrismaClient } from "@prisma/client";
import type { LoginResponseDTO } from "@razorgrowth/contracts";
import { AppError } from "../../http/errors.js";
import { verifyPassword } from "./password.js";
import { findMerchantUserByEmail } from "./repository.js";
import { createSession, revokeSession } from "./session.js";

/** Deliberately identical error for "no such email" and "wrong password"
 * (PART 10 §1) — a distinguishable response would let an attacker
 * enumerate registered merchant-user emails. */
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

export async function login(prisma: PrismaClient, email: string, password: string): Promise<LoginResponseDTO> {
  const user = await findMerchantUserByEmail(prisma, email);
  if (!user) throw AppError.unauthorized(INVALID_CREDENTIALS_MESSAGE);

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw AppError.unauthorized(INVALID_CREDENTIALS_MESSAGE);

  const session = await createSession(prisma, user.id);
  return {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: { id: user.id, email: user.email, role: user.role, merchantId: user.merchantId },
  };
}

export async function logout(prisma: PrismaClient, token: string): Promise<void> {
  await revokeSession(prisma, token);
}
