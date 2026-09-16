import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types/index.js';
import { AuthorizationError } from '../utils/errorGuards.js';

// Variadic: checkRole('SUPER_ADMIN', 'COMPANY_ADMIN')
export const checkRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        throw new AuthorizationError('User not authenticated');
      }

      if (!allowedRoles.includes(user.role)) {
        throw new AuthorizationError('Insufficient permissions');
      }

      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
};