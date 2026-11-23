/**
 * Stable, machine-readable error codes.
 *
 * The frontend switches on `error.code`, never on `error.message`.
 * Codes are additive: an existing code must never change meaning.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // OTP / login
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  ACCOUNT_TYPE_REQUIRED: 'ACCOUNT_TYPE_REQUIRED',
  ACCOUNT_TYPE_NOT_ALLOWED: 'ACCOUNT_TYPE_NOT_ALLOWED',
  ACCOUNT_TYPE_IMMUTABLE: 'ACCOUNT_TYPE_IMMUTABLE',
  USER_BLOCKED: 'USER_BLOCKED',
  CANNOT_BLOCK_ADMIN: 'CANNOT_BLOCK_ADMIN',
  CANNOT_BLOCK_SELF: 'CANNOT_BLOCK_SELF',
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];
