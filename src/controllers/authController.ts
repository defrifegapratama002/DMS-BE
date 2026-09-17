import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import { AppError } from '../utils/errorGuards.js';
import type { AuthRequest } from '../types/index.js';
import { z } from 'zod';
import crypto from 'crypto';

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10');

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z
    .enum(['SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR', 'EMPLOYEE'])
    .optional(),
  companyId: z.string().uuid().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// bcrypt bersalt → hash berbeda tiap kali, jadi tidak bisa dipakai untuk lookup.
// Token JWT sudah ber-entropi tinggi, SHA-256 deterministik cukup & aman.
const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const generateAccessToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET as string;
  const options: SignOptions = {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any,
  };
  return jwt.sign({ userId, type: 'access' }, secret, options);
};

const generateRefreshToken = async (userId: string): Promise<string> => {
  const secret = process.env.JWT_REFRESH_SECRET as string;
  const options: SignOptions = {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any,
  };
  // jti: dua token yang dibuat di detik yang sama tetap unik (tokenHash @unique)
  const token = jwt.sign(
    { userId, type: 'refresh', jti: crypto.randomUUID() },
    secret,
    options
  );

  const tokenHash = hashToken(token);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return token;
};

export const register = async (req: Request, res: Response) => {
  try {
    const validated = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: validated.email },
    });

    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    const hashedPassword = await bcrypt.hash(validated.password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email: validated.email,
        passwordHash: hashedPassword,   // ✅ passwordHash
        name: validated.name,
        role: validated.role || 'EMPLOYEE',
        companyId: validated.companyId || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    await logActivityWithRequest(
      req,
      user.id,
      'REGISTER',
      { email: user.email },
      'USER',
      user.id
    );

    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user, accessToken, refreshToken },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,   // ✅ .issues
      });
    }
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const validated = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: validated.email },
      include: { company: true },
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    const isValidPassword = await bcrypt.compare(
      validated.password,
      user.passwordHash    // ✅ passwordHash
    );

    if (!isValidPassword) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.active) {
      throw new AppError('Akun dinonaktifkan. Hubungi admin.', 403);
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logActivityWithRequest(
      req,
      user.id,
      'LOGIN',
      { email: user.email, company: user.company?.name },
      'USER',
      user.id
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company: user.company,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,
      });
    }
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const validated = refreshTokenSchema.parse(req.body);
    const { refreshToken: incomingToken } = validated;

    const decoded = jwt.verify(
      incomingToken,
      process.env.JWT_REFRESH_SECRET as string
    ) as unknown as { userId: string };

    const tokenHash = hashToken(incomingToken);
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        userId: decoded.userId,
        tokenHash,
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
    });

    if (!storedToken) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    if (storedToken.replacedBy) {
      await prisma.refreshToken.updateMany({
        where: { userId: decoded.userId },
        data: { revokedAt: new Date() },
      });
      throw new AppError('Token reuse detected - all tokens revoked', 401);
    }

    const newAccessToken = generateAccessToken(decoded.userId);
    const newRefreshToken = await generateRefreshToken(decoded.userId);

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { replacedBy: hashToken(newRefreshToken) },
    });

    res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,
      });
    }
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired',
      });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Refresh token error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    const { refreshToken: incomingToken } = req.body;

    if (incomingToken && userId) {
      const tokenHash = hashToken(incomingToken);
      await prisma.refreshToken.updateMany({
        where: { userId, tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (userId) {
      await logActivityWithRequest(req, userId, 'LOGOUT', {}, 'USER', userId);
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        active: true,
        lastLoginAt: true,
        company: {
          select: { id: true, name: true, domain: true },
        },
        createdAt: true,
        _count: {
          select: {
            folders: true,
            documents: true,
            shares: true,
            logs: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({ success: true, data: user });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};