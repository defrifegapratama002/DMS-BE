import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './verifyToken.js';

export const checkRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Autentikasi diperlukan.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengakses sumber daya ini.' });
      return;
    }

    next();
  };
};