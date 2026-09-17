import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { AuthRequest } from '../types/index.js';
import {
  canReadAll,
  isAdmin,
  visibleDocumentsWhere,
  visibleFoldersWhere,
} from '../utils/access.js';

const LIST_INCLUDE = {
  folder: { select: { id: true, name: true } },
  documentTags: { include: { tag: true } },
} satisfies Prisma.DocumentInclude;

// GET /stats/dashboard?days=7
// Agregasi untuk dashboard, dibatasi ke data yang boleh dilihat user.
export const getDashboardStats = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const user = req.user!;
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const docWhere = visibleDocumentsWhere(user);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const [
      folders,
      documents,
      sizeAgg,
      statusGroups,
      typeGroups,
      tags,
      recentDocuments,
      pendingReview,
      recentLogs,
    ] = await Promise.all([
      prisma.folder.count({ where: visibleFoldersWhere(user) }),
      prisma.document.count({ where: docWhere }),
      prisma.document.aggregate({ where: docWhere, _sum: { sizeBytes: true } }),
      prisma.document.groupBy({ by: ['status'], where: docWhere, _count: true }),
      prisma.document.groupBy({
        by: ['documentTypeId'],
        where: { AND: [docWhere, { documentTypeId: { not: null } }] },
        _count: true,
      }),
      prisma.tag.findMany({
        include: { _count: { select: { documents: { where: { document: docWhere } } } } },
      }),
      prisma.document.findMany({
        where: docWhere,
        omit: { contentText: true },
        include: LIST_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      // Antrian review hanya relevan untuk admin
      isAdmin(user.role)
        ? prisma.document.findMany({
            where: { deletedAt: null, status: 'PENDING_REVIEW' },
            omit: { contentText: true },
            include: LIST_INCLUDE,
            orderBy: { updatedAt: 'desc' },
            take: 5,
          })
        : Promise.resolve(null),
      prisma.activityLog.findMany({
        where: {
          createdAt: { gte: since },
          ...(canReadAll(user.role) ? {} : { userId: user.id }),
        },
        select: { createdAt: true },
      }),
    ]);

    const byStatus = { DRAFT: 0, PENDING_REVIEW: 0, APPROVED: 0, ARCHIVED: 0 };
    for (const g of statusGroups) byStatus[g.status] = g._count;

    const types = await prisma.documentType.findMany({
      where: { id: { in: typeGroups.map((g) => g.documentTypeId!) } },
      select: { id: true, name: true },
    });
    const byType = typeGroups
      .map((g) => ({
        id: g.documentTypeId!,
        name: types.find((t) => t.id === g.documentTypeId)?.name ?? '—',
        count: g._count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const byTag = tags
      .map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.documents }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Bucket per hari (zona waktu server) — hari tanpa aktivitas tetap muncul dengan 0.
    const activitySeries: Array<{ date: string; count: number }> = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      const key = day.toDateString();
      activitySeries.push({
        date: day.toISOString(),
        count: recentLogs.filter((l) => l.createdAt.toDateString() === key).length,
      });
    }

    res.json({
      success: true,
      data: {
        folders,
        documents,
        totalBytes: sizeAgg._sum.sizeBytes ?? BigInt(0),
        byStatus,
        byTag,
        byType,
        recentDocuments,
        pendingReview,
        activitySeries,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
