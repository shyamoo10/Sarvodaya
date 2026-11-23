import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError, type ValidationIssue } from '../lib/http';
import { ErrorCode } from '../config/error-codes';
import { logger } from '../lib/logger';
import { env } from '../config/env';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new ApiError(
      404,
      ErrorCode.ROUTE_NOT_FOUND,
      `No route matches ${req.method} ${req.originalUrl}`,
    ),
  );
};

function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

/**
 * Every error response has this shape:
 *   { "success": false, "error": { "code": "...", "message": "...", "details"?: ... },
 *     "requestId": "..." }
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestIdValue = req.requestId ?? '';

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      requestId: requestIdValue,
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: zodIssues(error),
      },
      requestId: requestIdValue,
    });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request body is not valid JSON',
        details: [{ field: 'body', message: 'Malformed JSON payload' }],
      },
      requestId: requestIdValue,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: { code: ErrorCode.NOT_FOUND, message: 'Requested record was not found' },
        requestId: requestIdValue,
      });
      return;
    }
    if (error.code === 'P2002') {
      res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'A record with these values already exists',
          details: [{ field: 'body', message: 'Duplicate value' }],
        },
        requestId: requestIdValue,
      });
      return;
    }
  }

  logger.error(
    { err: error, requestId: requestIdValue, path: req.originalUrl, method: req.method },
    'Unhandled error',
  );

  res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: env.isProduction
        ? 'Something went wrong. Please try again.'
        : error instanceof Error
          ? error.message
          : 'Something went wrong',
    },
    requestId: requestIdValue,
  });
};
