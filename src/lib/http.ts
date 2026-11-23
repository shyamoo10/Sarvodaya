import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ErrorCodeName } from '../config/error-codes';

export type ValidationIssue = { field: string; message: string };

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeName;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCodeName, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Every successful response has this shape:
 *   { "success": true, "data": ... , "meta"?: ... }
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): Response {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

/** Express 5 forwards rejected promises to the error handler, but wrapping keeps intent explicit. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function parsePagination(query: {
  page?: string;
  limit?: string;
}): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? '20', 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
