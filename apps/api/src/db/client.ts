/**
 * Single shared Prisma client instance (PART 01 §62 — centralize database
 * access; do not instantiate `PrismaClient` ad hoc across the codebase).
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
