/**
 * Deterministic canonical JSON serialization (PART 05 §16, §58, §139).
 *
 * Used everywhere a stable hash must be computed over structured data — the
 * proposal fingerprint and the ledger hash chain both build on this. Plain
 * `JSON.stringify` is NOT safe for that purpose because object key order
 * depends on construction order, not semantic content; two objects with
 * identical meaning but different insertion order would hash differently.
 * This function recursively sorts object keys (arrays keep the order the
 * caller gave them, since order is sometimes semantically meaningful and
 * callers that don't want that must sort before calling) so the same
 * logical value always serializes identically.
 *
 * Deliberately minimal: no BigInt/Date/Map/Set support, because the only
 * inputs are plain JSON-safe records built specifically for hashing
 * (never raw Prisma rows or Date objects) — every caller normalizes first.
 */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalStringify(value: CanonicalValue): string {
  return stringify(value);
}

function stringify(value: CanonicalValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(value[k]!)}`).join(",")}}`;
  }
  // string | number | boolean — JSON.stringify is stable for these primitives.
  return JSON.stringify(value);
}
