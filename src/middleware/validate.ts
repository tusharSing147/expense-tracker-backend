import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validate(schemas: {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}): RequestHandler {
  return (req, _res, next) => {
    if (schemas.body !== undefined) {
      req.body = schemas.body.parse(req.body);
    }
    if (schemas.query !== undefined) {
      const parsed = schemas.query.parse(req.query);
      Object.defineProperty(req, 'query', {
        value: parsed,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    if (schemas.params !== undefined) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }
    next();
  };
}
