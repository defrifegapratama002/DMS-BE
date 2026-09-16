import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errorGuards.js';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const SALT_ROUNDS = 10;

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z
    .enum(['SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR', 'EMPLOYEE'])
    .optional(),
  companyId: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z
    .enum(['SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR', 'EMPLOYEE'])
    .optional(),
  active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

export class UserController {
  // ============ LIST USERS ============
  static async getUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        role,
        include_inactive,
        includeInactive,   // ← support camelCase juga
      } = req.query;

      const includeInactiveValue = include_inactive || includeInactive || 'false';

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      // ✅ Fix: pakai includeInactiveValue
      if (includeInactiveValue !== 'true') {
        where.active = true;
      }

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { email: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      if (role) {
        where.role = role as string;
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyId: true,
            active: true,
            lastLoginAt: true,
            company: { select: { id: true, name: true } },
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                documents: true,
                folders: true,
              },
            },
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
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ============ GET USER BY ID ============
  static async getUserById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          companyId: true,
          active: true,
          lastLoginAt: true,
          company: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              documents: true,
              folders: true,
              shares: true,
              logs: true,
            },
          },
        },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.json({ success: true, data: user });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ============ CREATE USER ============
  static async createUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const validated = createUserSchema.parse(req.body);
      const currentUser = req.user!;

      // Check existing email
      const existing = await prisma.user.findUnique({
        where: { email: validated.email },
      });
      if (existing) {
        res.status(409).json({ success: false, message: 'Email already exists' });
        return;
      }

      // COMPANY_ADMIN tidak bisa create SUPER_ADMIN
      if (validated.role === 'SUPER_ADMIN' && currentUser.role !== 'SUPER_ADMIN') {
        res
          .status(403)
          .json({ success: false, message: 'Only SUPER_ADMIN can create SUPER_ADMIN' });
        return;
      }

      const hashedPassword = await bcrypt.hash(validated.password, SALT_ROUNDS);

      const user = await prisma.user.create({
        data: {
          email: validated.email,
          passwordHash: hashedPassword,
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
          active: true,
          createdAt: true,
        },
      });

      await logActivityWithRequest(
        req,
        currentUser.id,
        'UPDATE_USER',
        { action: 'CREATE_USER', newUserId: user.id, email: user.email },
        'USER',
        user.id
      );

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: user,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.issues,
        });
        return;
      }
      console.error('Create user error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ============ UPDATE USER ============
  static async updateUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = updateUserSchema.parse(req.body);
      const currentUser = req.user!;

      // Prevent self-role change
      if (id === currentUser.id && validated.role) {
        res.status(400).json({
          success: false,
          message: 'Cannot change your own role',
        });
        return;
      }

      // Only SUPER_ADMIN can change roles
      if (validated.role && currentUser.role !== 'SUPER_ADMIN') {
        res
          .status(403)
          .json({ success: false, message: 'Only SUPER_ADMIN can change user roles' });
        return;
      }

      // Prevent non-SUPER_ADMIN touching SUPER_ADMIN
      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      if (targetUser.role === 'SUPER_ADMIN' && currentUser.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          success: false,
          message: 'Cannot modify SUPER_ADMIN',
        });
        return;
      }

      const user = await prisma.user.update({
        where: { id },
        data: validated,
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
        { userId: id, changes: validated },
        'USER',
        id
      );

      res.json({
        success: true,
        message: 'User updated successfully',
        data: user,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.issues,
        });
        return;
      }
      console.error('Update user error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ============ DELETE USER (soft delete via active=false) ============
  static async deleteUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const currentUser = req.user!;

      if (id === currentUser.id) {
        res
          .status(400)
          .json({ success: false, message: 'Cannot delete your own account' });
        return;
      }

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      // Soft delete: set active = false
      await prisma.user.update({
        where: { id },
        data: { active: false },
      });

      await logActivityWithRequest(
        req,
        currentUser.id,
        'DELETE_USER',
        { userId: id, email: targetUser.email, mode: 'soft-delete' },
        'USER',
        id
      );

      res.json({ success: true, message: 'User deactivated successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ============ RESET PASSWORD ============
  static async resetPassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = resetPasswordSchema.parse(req.body);
      const currentUser = req.user!;

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const hashedPassword = await bcrypt.hash(validated.newPassword, SALT_ROUNDS);

      await prisma.user.update({
        where: { id },
        data: { passwordHash: hashedPassword },
      });

      await logActivityWithRequest(
        req,
        currentUser.id,
        'RESET_PASSWORD',
        { userId: id, email: targetUser.email },
        'USER',
        id
      );

      res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.issues,
        });
        return;
      }
      console.error('Reset password error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}