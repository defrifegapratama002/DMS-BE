import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';

export const validate = (schema: ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.issues,
        });
        return;
      }
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
};

/** Validasi satu bagian request saja (skema ditulis langsung untuk body / query). */
const validatePart = (part: 'body' | 'query') => (schema: ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(req[part]);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: error.issues[0]?.message ?? 'Validation error',
          errors: error.issues,
        });
        return;
      }
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
};

export const validateBody = validatePart('body');
export const validateQuery = validatePart('query');