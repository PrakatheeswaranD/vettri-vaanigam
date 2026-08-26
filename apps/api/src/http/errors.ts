/**
 * Structured application errors (PART 00 §39; PART 01 §27).
 *
 * Every thrown `AppError` maps to a consistent, safe error envelope. It
 * never leaks a stack trace, secret, or internal implementation detail to
 * the client — those go to the structured log only, keyed by `requestId`
 * so they can be correlated after the fact.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "POLICY_DENIED"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  // PART 05 §107 — governance-specific domain errors, mapped to safe HTTP
  // semantics rather than a generic 500 for an expected outcome.
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_DECIDED"
  | "PROPOSAL_CHANGED"
  | "POLICY_CHANGED"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_NOT_ALLOWED"
  | "INVALID_STATE_TRANSITION"
  | "LEDGER_INTEGRITY_ERROR"
  // PART 06 §116-§117 — commerce-execution-specific domain errors.
  | "PRICE_CHANGED"
  | "INSUFFICIENT_INVENTORY"
  | "PRODUCT_NOT_ELIGIBLE"
  | "COMMERCE_STATE_CHANGED"
  | "IDEMPOTENCY_CONFLICT"
  | "AUTHORIZATION_ALREADY_CONSUMED"
  // PART 07 §135-§139 — payment-specific domain errors.
  | "CHECKOUT_NOT_PAYABLE"
  | "CHECKOUT_EXPIRED"
  | "PAYMENT_ALREADY_ATTEMPTED"
  | "PAYMENT_PROVIDER_ERROR"
  | "PAYMENT_NOT_CONFIGURED"
  | "PAYMENT_VERIFICATION_FAILED"
  | "FINANCIAL_INTEGRITY_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  APPROVAL_REQUIRED: 409,
  APPROVAL_EXPIRED: 409,
  APPROVAL_ALREADY_DECIDED: 409,
  PROPOSAL_CHANGED: 409,
  POLICY_CHANGED: 409,
  AUTHORIZATION_EXPIRED: 409,
  AUTHORIZATION_NOT_ALLOWED: 403,
  INVALID_STATE_TRANSITION: 409,
  LEDGER_INTEGRITY_ERROR: 500,
  PRICE_CHANGED: 409,
  INSUFFICIENT_INVENTORY: 409,
  PRODUCT_NOT_ELIGIBLE: 409,
  COMMERCE_STATE_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  AUTHORIZATION_ALREADY_CONSUMED: 409,
  CHECKOUT_NOT_PAYABLE: 409,
  CHECKOUT_EXPIRED: 409,
  PAYMENT_ALREADY_ATTEMPTED: 409,
  PAYMENT_PROVIDER_ERROR: 502,
  PAYMENT_NOT_CONFIGURED: 503,
  PAYMENT_VERIFICATION_FAILED: 400,
  FINANCIAL_INTEGRITY_ERROR: 409,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** Safe-to-expose metadata only — never put secrets or internals here. */
  readonly safeContext?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, safeContext?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.safeContext = safeContext;
  }

  static notFound(message: string, safeContext?: Record<string, unknown>): AppError {
    return new AppError("NOT_FOUND", message, safeContext);
  }

  static validation(message: string, safeContext?: Record<string, unknown>): AppError {
    return new AppError("VALIDATION_ERROR", message, safeContext);
  }

  static conflict(message: string, safeContext?: Record<string, unknown>): AppError {
    return new AppError("CONFLICT", message, safeContext);
  }
}

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}

export function toErrorResponseBody(code: ErrorCode, message: string, requestId: string): ErrorResponseBody {
  return { error: { code, message, requestId } };
}
