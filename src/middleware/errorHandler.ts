import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { logger } from '../config/logger';
import { env } from '../config/env';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
};

function getBodyParserType(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string') {
    return err.type;
  }
  return undefined;
}

function mapError(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: err.issues.map((issue) => ({
            field: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        },
      },
    };
  }

  const parserType = getBodyParserType(err);
  if (parserType === 'entity.parse.failed') {
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' } },
    };
  }
  if (parserType === 'entity.too.large') {
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Request body too large' } },
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return { status: 409, body: { error: { code: 'CONFLICT', message: 'Resource already exists' } } };
    }
    if (err.code === 'P2025') {
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Resource not found' } } };
    }
    if (err.code === 'P2003') {
      return {
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid related resource' } },
      };
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' } },
    };
  }

  if (err instanceof TokenExpiredError) {
    return { status: 401, body: { error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' } } };
  }

  if (err instanceof JsonWebTokenError) {
    return {
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing access token' } },
    };
  }

  const message =
    env.NODE_ENV === 'production' || !(err instanceof Error)
      ? 'Something went wrong'
      : err.message;
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message } } };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error: unknown = err;
  const { status, body } = mapError(error);
  if (status === 500) {
    const reqId = (req as { id?: string | number }).id;
    logger.error({ reqId, err: error }, 'unhandled error');
  }
  res.status(status).json(body);
};
