import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_ACCESS_SECRET) {
  throw new Error('JWT_ACCESS_SECRET wajib di-set di environment variables.');
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

interface JwtPayload {
  userId: string;
  role: string;
  iat: number;
  exp: number;
}

export const verifyToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Token autentikasi tidak ditemukan.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: 'Token autentikasi tidak valid.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET as string) as unknown as JwtPayload;
    req.user = { userId: decoded.userId, role: decoded.role };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'Sesi telah kedaluwarsa, silakan login kembali.' });
      return;
    }
    res.status(401).json({ message: 'Token tidak valid.' });
  }
};