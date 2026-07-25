import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';

export interface RequestWithValidatedQuery<T = unknown> extends Request {
  validatedQuery?: T;
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        message: 'Data yang dikirim tidak valid.',
        errors: formatZodError(result.error),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: RequestWithValidatedQuery, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        message: 'Parameter query tidak valid.',
        errors: formatZodError(result.error),
      });
      return;
    }

    req.validatedQuery = result.data;
    next();
  };
}

function formatZodError(error: ZodError): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'root';
    formatted[path] = issue.message;
  }
  return formatted;
}