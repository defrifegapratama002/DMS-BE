import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errorGuards.js';
import { getParam, detailsToString } from '../utils/helpers.js';
import type { ActivityAction, EntityType, AuthRequest } from '../types/index.js';

export class ActivityLogController {
  static async getLogs(req: Request, res: Response) {
    try {
      const {
        userId,
        action,
        entityType,
        entityId,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = req.query;

      const currentUser = (req as AuthRequest).user!;
      if (
        currentUser.role !== 'SUPER_ADMIN' &&
        currentUser.role !== 'COMPANY_ADMIN'
      ) {
        if (userId && userId !== currentUser.id) {
          throw new AppError('Access denied', 403);
        }
      }

      const where: any = {};
      if (userId) where.userId = userId;
      if (action) where.action = action;
      if (entityType) where.entityType = entityType;
      if (entityId) where.entityId = entityId;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate as string);
        if (endDate) where.createdAt.lte = new Date(endDate as string);
      }

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      const [logs, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
        }),
        prisma.activityLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Get activity logs error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async getMyActivity(req: Request, res: Response) {
    try {
      const userId = (req as AuthRequest).user!.id;
      const { limit = 20 } = req.query;

      const logs = await prisma.activityLog.findMany({
        where: { userId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
      });

      res.json({ success: true, data: logs });
    } catch (error) {
      console.error('Get user activity error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async getStats(req: Request, res: Response) {
    try {
      const currentUser = (req as AuthRequest).user!;
      const { userId } = req.query;

      if (
        currentUser.role !== 'SUPER_ADMIN' &&
        currentUser.role !== 'COMPANY_ADMIN'
      ) {
        if (userId && userId !== currentUser.id) {
          throw new AppError('Access denied', 403);
        }
      }

      const where =
        currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'COMPANY_ADMIN'
          ? userId
            ? { userId: userId as string }
            : {}
          : { userId: currentUser.id };

      const [totalActivities, actionCounts, recentActivity] = await Promise.all([
        prisma.activityLog.count({ where }),
        prisma.activityLog.groupBy({
          by: ['action'],
          where,
          _count: true,
        }),
        prisma.activityLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
      ]);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const dailyActivity = await prisma.$queryRaw<
        Array<{ date: Date; count: bigint }>
      >`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM activity_logs
        WHERE created_at >= ${sevenDaysAgo}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;

      res.json({
        success: true,
        data: {
          totalActivities,
          actionCounts: actionCounts.map((item) => ({
            action: item.action,
            count: item._count,
          })),
          dailyActivity: dailyActivity.map((d) => ({
            date: d.date,
            count: Number(d.count),
          })),
          recentActivity,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Get stats error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async exportCsv(req: Request, res: Response) {
    try {
      const { userId, action, startDate, endDate } = req.query;
      const currentUser = (req as AuthRequest).user!;

      if (
        currentUser.role !== 'SUPER_ADMIN' &&
        currentUser.role !== 'AUDITOR'
      ) {
        throw new AppError('Access denied', 403);
      }

      const where: any = {};
      if (userId) where.userId = userId;
      if (action) where.action = action;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate as string);
        if (endDate) where.createdAt.lte = new Date(endDate as string);
      }

      const logs = await prisma.activityLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const safe = (val: any): string => {
        if (val === null || val === undefined) return '';
        return String(val).replace(/"/g, '""');
      };

      const csv = [
        'ID,User Name,User Email,Action,Entity Type,Entity ID,Details,IP Address,Created At',
        ...logs.map((log) =>
          [
            safe(log.id),
            safe(log.user?.name),
            safe(log.user?.email),
            safe(log.action),
            safe(log.entityType),
            safe(log.entityId),
            safe(log.details ? detailsToString(log.details) : ''),
            safe(log.ipAddress),
            log.createdAt.toISOString(),
          ]
            .map((v) => `"${v}"`)
            .join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-logs-${Date.now()}.csv"`
      );
      res.send('\uFEFF' + csv);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Export CSV error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

// Legacy exports (agar routes yang sudah ada tetap jalan)
export const getLogs = ActivityLogController.getLogs;
export const getMyActivity = ActivityLogController.getMyActivity;
export const getStats = ActivityLogController.getStats;
export const exportCsv = ActivityLogController.exportCsv;