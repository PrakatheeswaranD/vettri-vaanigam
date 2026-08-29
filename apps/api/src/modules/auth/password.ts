/**
 * Password hashing (PART 10 §1). Uses Node's built-in `crypto.scrypt` —
 * a real, memory-hard KDF — rather than adding an external dependency
 * (`bcrypt`, `argon2`) for something the runtime already provides
 * correctly. Never stores or logs a plaintext password anywhere.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = (await scrypt(plaintext, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scrypt(plaintext, salt, expectedKey.length)) as Buffer;
  // Constant-time comparison — never a plain `===` on secret material.
  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
}
