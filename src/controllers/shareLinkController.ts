import type { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import type { AuthRequest } from '../types/index.js';
import { getClientIp, logActivity, logActivityWithRequest } from '../utils/activityLogger.js';
import { isAdmin } from '../utils/access.js';
import { mimeForExtension } from '../utils/fileInfo.js';

const createLinkSchema = z.object({
  access: z.enum(['VIEWER', 'DOWNLOADER']).default('VIEWER'),
  // null = tanpa batas waktu
  expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
});

/** Sama seperti share ke user: admin bebas, selain itu pemilik folder / pengunggah. */
async function findManageableDocument(id: string, user: { id: string; role: string }) {
  const document = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    include: { folder: { select: { ownerId: true, name: true } } },
  });
  if (!document) return null;
  const allowed =
    isAdmin(user.role) ||
    document.uploadedBy === user.id ||
    document.folder.ownerId === user.id;
  return allowed ? document : null;
}

/** Tautan aktif: ada dan belum kedaluwarsa. */
async function resolveToken(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      document: { include: { folder: { select: { name: true } } } },
    },
  });
  if (!link || link.document.deletedAt) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;
  return link;
}

export class ShareLinkController {
  // GET /shares/documents/:id/links
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const document = await findManageableDocument(req.params.id as string, req.user!);
      if (!document) {
        res.status(404).json({ success: false, message: 'Not found or access denied' });
        return;
      }

      const links = await prisma.shareLink.findMany({
        where: { documentId: document.id },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: links });
    } catch (error) {
      console.error('List share links error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // POST /shares/documents/:id/links
  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const validated = createLinkSchema.parse(req.body);

      const document = await findManageableDocument(req.params.id as string, user);
      if (!document) {
        res.status(404).json({ success: false, message: 'Not found or access denied' });
        return;
      }

      const link = await prisma.shareLink.create({
        data: {
          documentId: document.id,
          token: crypto.randomBytes(24).toString('base64url'),
          access: validated.access,
          expiresAt: validated.expires_in_days
            ? new Date(Date.now() + validated.expires_in_days * 86_400_000)
            : null,
          createdBy: user.id,
        },
      });

      await logActivityWithRequest(
        req,
        user.id,
        'CREATE_SHARE_LINK',
        {
          title: document.title,
          access: link.access,
          expiresInDays: validated.expires_in_days ?? null,
        },
        'DOCUMENT',
        document.id
      );

      res.status(201).json({ success: true, data: link });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Create share link error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // DELETE /shares/links/:linkId
  static async revoke(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const link = await prisma.shareLink.findUnique({
        where: { id: req.params.linkId as string },
      });
      if (!link || !(await findManageableDocument(link.documentId, user))) {
        res.status(404).json({ success: false, message: 'Not found or access denied' });
        return;
      }

      await prisma.shareLink.delete({ where: { id: link.id } });

      await logActivityWithRequest(
        req,
        user.id,
        'REVOKE_SHARE_LINK',
        { linkId: link.id },
        'DOCUMENT',
        link.documentId
      );

      res.json({ success: true, message: 'Share link revoked' });
    } catch (error) {
      console.error('Revoke share link error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ---------- PUBLIK (tanpa login) ----------

  // GET /public/share/:token
  static async resolve(req: Request, res: Response): Promise<void> {
    try {
      const link = await resolveToken(req.params.token as string);
      if (!link) {
        res.status(404).json({
          success: false,
          message: 'Tautan tidak valid, sudah dicabut, atau kedaluwarsa.',
        });
        return;
      }

      const updated = await prisma.shareLink.update({
        where: { id: link.id },
        data: { accessCount: { increment: 1 } },
      });

      await logActivity({
        userId: link.createdBy,
        action: 'ACCESS_SHARE_LINK',
        entityType: 'DOCUMENT',
        entityId: link.documentId,
        details: { title: link.document.title, via: 'public-link' },
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });

      const { document, ...rest } = link;
      res.json({
        success: true,
        data: {
          link: { ...rest, accessCount: updated.accessCount },
          document: {
            id: document.id,
            title: document.title,
            extension: document.extension,
            status: document.status,
            currentVersion: document.currentVersion,
            updatedAt: document.updatedAt,
            sizeBytes: document.sizeBytes,
            folderName: document.folder.name,
          },
        },
      });
    } catch (error) {
      console.error('Resolve share link error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // GET /public/share/:token/file?download=1
  static async file(req: Request, res: Response): Promise<void> {
    try {
      const link = await resolveToken(req.params.token as string);
      if (!link) {
        res.status(404).json({ success: false, message: 'Tautan tidak valid atau kedaluwarsa.' });
        return;
      }

      const isDownload = req.query.download === '1' || req.query.download === 'true';
      if (isDownload && link.access !== 'DOWNLOADER') {
        res.status(403).json({ success: false, message: 'Tautan ini hanya untuk melihat.' });
        return;
      }

      const version = await prisma.documentVersion.findUnique({
        where: {
          documentId_versionNumber: {
            documentId: link.documentId,
            versionNumber: link.document.currentVersion,
          },
        },
      });
      const absolute = version ? path.resolve(version.s3FileKey) : null;
      if (!absolute || !fs.existsSync(absolute)) {
        res.status(404).json({ success: false, message: 'File tidak ditemukan di storage' });
        return;
      }

      const ext = path.extname(absolute).slice(1) || link.document.extension;
      const filename = `${link.document.title}.${ext}`;
      res.setHeader('Content-Type', mimeForExtension(ext));
      res.setHeader(
        'Content-Disposition',
        `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      fs.createReadStream(absolute).pipe(res);
    } catch (error) {
      console.error('Public share file error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
