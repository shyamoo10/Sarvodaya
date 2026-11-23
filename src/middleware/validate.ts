import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { ApiError, type ValidationIssue } from '../lib/http';
import { ErrorCode } from '../config/error-codes';

export type RequestPart = 'body' | 'query' | 'params';

/**
 * Parses and replaces the chosen request part with validated, coerced output.
 * Invalid input never reaches a route handler.
 */
export function validate(schema: ZodTypeAny, part: RequestPart = 'body'): RequestHandler {
  return (req, _res, next) => {
    // Express 5 leaves req.body as undefined when the request has no body at all.
    const raw = part === 'body' ? (req.body ?? {}) : req[part];
    const result = schema.safeParse(raw);
    if (!result.success) {
      const details: ValidationIssue[] = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || part,
        message: issue.message,
      }));
      next(new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', details));
      return;
    }
    // req.query is a getter in Express 5, so the parsed value is defined as an
    // own property instead of being assigned.
    Object.defineProperty(req, part, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
