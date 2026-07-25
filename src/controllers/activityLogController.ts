import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import type { RequestWithValidatedQuery } from '../middlewares/validate.js';
import type { activityLogQuerySchema } from '../schemas/activityLogSchemas.js';
import type { z } from 'zod';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>;
type AuthRequestWithQuery = AuthRequest & RequestWithValidatedQuery<ActivityLogQuery>;

// 1. FUNGSI MELIHAT ACTIVITY LOG (DENGAN FILTER & PAGINATION)
export const getActivityLogs = async (req: AuthRequestWithQuery, res: Response): Promise<void> => {
  try {
    // validatedQuery dijamin ada karena middleware validateQuery selalu jalan
    // sebelum controller ini, dan sudah menyertakan default page=1, limit=20.
    const { action, page, limit } = req.validatedQuery!;

    const isGlobalAccess = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'AUDITOR';

    const where: Record<string, unknown> = {};
    if (!isGlobalAccess) {
      where.user_id = req.user!.userId;
    }
    if (action) {
      where.action = action;
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.activityLog.count({ where }),
    ]);

    res.status(200).json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get Activity Logs Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengambil activity log.' });
  }
};

// 2. FUNGSI MENGEKSPOR ACTIVITY LOG KE CSV
export const exportActivityLogsCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'AUDITOR') {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengekspor activity log.' });
      return;
    }

    const logs = await prisma.activityLog.findMany({
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10000,
    });

    const header = 'Timestamp,User,Email,Action,Details,IP Address\n';
    const rows = logs
      .map((log) => {
        const safe = (val: string) => `"${val.replace(/"/g, '""')}"`;
        return [
          log.created_at.toISOString(),
          safe(log.user.name),
          safe(log.user.email),
          log.action,
          safe(log.details),
          log.ip_address,
        ].join(',');
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${Date.now()}.csv"`);
    res.status(200).send(header + rows);
  } catch (error) {
    console.error('Export Activity Log Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengekspor activity log.' });
  }
};