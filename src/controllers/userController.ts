import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errorGuards.js';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import bcrypt from 'bcrypt';

export class UserController {
  static async getUsers(req: AuthRequest, res: Response): Promise<void> {
    const { page = 1, limit = 10, search, role } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role as string;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          companyId: true,
          company: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { documents: true, folders: true } },
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  }

  static async getUserById(req: AuthRequest, res: Response): Promise<void> {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        company: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { documents: true, folders: true, shares: true, logs: true },
        },
      },
    });

    if (!user) throw new AppError('User not found', 404);
    res.json({ success: true, data: user });
  }

  static async createUser(req: AuthRequest, res: Response): Promise<void> {
    const { email, password, name, role } = req.body;
    const currentUser = req.user!;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email already exists', 409);

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash: hashedPassword, name, role: role || 'EMPLOYEE' },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    await logActivityWithRequest(
      req,
      currentUser.id,
      'UPDATE_USER',
      { action: 'CREATE_USER', email },
      'USER',
      user.id
    );

    res.status(201).json({ success: true, data: user });
  }

  static async updateUser(req: AuthRequest, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { name, role, active } = req.body;
    const currentUser = req.user!;

    if (role && currentUser.role !== 'SUPER_ADMIN') {
      throw new AppError('Only SUPER_ADMIN can change user roles', 403);
    }

    const user = await prisma.user.update({
      where: { id },
      data: { name, role, active },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        updatedAt: true,
      },
    });

    await logActivityWithRequest(
      req,
      currentUser.id,
      'UPDATE_USER',
      { userId: id, changes: { name, role, active } },
      'USER',
      id
    );

    res.json({ success: true, message: 'User updated successfully', data: user });
  }

  static async deleteUser(req: AuthRequest, res: Response): Promise<void> {
    const id = req.params.id as string;
    const currentUser = req.user!;

    if (id === currentUser.id) {
      throw new AppError('Cannot delete your own account', 400);
    }

    await prisma.user.delete({ where: { id } });

    await logActivityWithRequest(
      req,
      currentUser.id,
      'DELETE_USER',
      { userId: id },
      'USER',
      id
    );

    res.json({ success: true, message: 'User deleted successfully' });
  }

  static async resetPassword(req: AuthRequest, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { newPassword } = req.body;
    const currentUser = req.user!;

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id },
      data: { passwordHash: hashedPassword }, // ✅ passwordHash
    });

    await logActivityWithRequest(
      req,
      currentUser.id,
      'RESET_PASSWORD',
      { userId: id },
      'USER',
      id
    );

    res.json({ success: true, message: 'Password reset successfully' });
  }
}