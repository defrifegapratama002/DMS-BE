import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';

const createDocumentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  folderId: z.string().uuid(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED']).optional(),
});

// ============ GET ALL ============
export const getDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { folderId, search, status, page = 1, limit = 10 } = req.query;

    const where: any = {};
    if (folderId) where.folderId = folderId as string;
    if (status) where.status = status as string;
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: {
          folder: { select: { id: true, name: true } },
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: {
              id: true,
              versionNumber: true,
              changelog: true,
              createdAt: true,
            },
          },
          shares: {
            where: { userId },
            select: { accessLevel: true, userId: true }, // ✅ userId disertakan
          },
        },
        skip,
        take: limitNum,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.document.count({ where }),
    ]);

    const documentsWithAccess = documents.map((doc) => {
      const userShare = doc.shares.find((s) => s.userId === userId);
      return {
        ...doc,
        accessLevel: userShare?.accessLevel || null,
        isOwner: doc.uploadedBy === userId,
      };
    });

    res.json({
      success: true,
      data: {
        documents: documentsWithAccess,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ UPLOAD ============
export const uploadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const validated = createDocumentSchema.parse(req.body);
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      res.status(400).json({ success: false, message: 'File is required' });
      return;
    }

    const folder = await prisma.folder.findFirst({
      where: { id: validated.folderId, ownerId: userId },
    });

    if (!folder) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(404).json({ success: false, message: 'Folder not found or not owned' });
      return;
    }

    const document = await prisma.document.create({
      data: {
        title: validated.title,
        extension: path.extname(file.originalname).slice(1),
        sizeBytes: BigInt(file.size),
        folderId: validated.folderId,
        description: validated.description || '',
        uploadedBy: userId,
        currentVersion: 1,
        status: 'DRAFT',
        versions: {
          create: {
            versionNumber: 1,
            s3FileKey: file.path,
            uploadedBy: userId,
            changelog: 'Initial upload',
          },
        },
      },
      include: {
        folder: { select: { id: true, name: true } },
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });

    await logActivityWithRequest(
      req,
      userId,
      'CREATE_DOCUMENT',
      { title: document.title, fileName: file.originalname, fileSize: file.size, version: 1 },
      'DOCUMENT',
      document.id
    );

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: document,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ DETAIL ============
export const getDocumentDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        folder: true,
        uploadedByUser: { select: { id: true, name: true, email: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
        shares: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    const userShare = document.shares.find((s) => s.userId === userId);
    const hasAccess = document.uploadedBy === userId || userShare || document.status === 'APPROVED';

    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    await logActivityWithRequest(
      req,
      userId,
      'VIEW_DOCUMENT',
      { title: document.title, version: document.currentVersion },
      'DOCUMENT',
      document.id
    );

    res.json({
      success: true,
      data: {
        ...document,
        userAccess: {
          isOwner: document.uploadedBy === userId,
          accessLevel: userShare?.accessLevel || null,
        },
      },
    });
  } catch (error) {
    console.error('Get document detail error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ UPDATE / RENAME ============
export const updateDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;
    const validated = updateDocumentSchema.parse(req.body);

    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    const userShare = await prisma.documentShare.findFirst({
      where: { documentId: id, userId, accessLevel: 'EDITOR' },
    });

    if (existing.uploadedBy !== userId && !userShare) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const updated = await prisma.document.update({ where: { id }, data: validated });

    await logActivityWithRequest(
      req,
      userId,
      'RENAME_DOCUMENT',
      { title: updated.title, changes: validated },
      'DOCUMENT',
      updated.id
    );

    res.json({ success: true, message: 'Document updated successfully', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Update document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const renameDocument = updateDocument;

// ============ UPLOAD NEW VERSION ============
export const uploadNewVersion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;
    const { changelog } = req.body;
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      res.status(400).json({ success: false, message: 'File is required' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: { shares: { where: { userId, accessLevel: 'EDITOR' } } },
    });

    if (!document) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    const hasEditAccess = document.uploadedBy === userId || document.shares.length > 0;
    if (!hasEditAccess) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(403).json({ success: false, message: 'Access denied. EDITOR access required.' });
      return;
    }

    const newVersion = document.currentVersion + 1;

    const updatedDocument = await prisma.document.update({
      where: { id },
      data: {
        currentVersion: newVersion,
        versions: {
          create: {
            versionNumber: newVersion,
            s3FileKey: file.path,
            uploadedBy: userId,
            changelog: changelog || 'New version uploaded',
          },
        },
      },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    await logActivityWithRequest(
      req,
      userId,
      'UPLOAD_VERSION',
      {
        title: document.title,
        fileName: file.originalname,
        fileSize: file.size,
        version: newVersion,
        changelog,
      },
      'DOCUMENT',
      document.id
    );

    res.json({ success: true, message: 'New version uploaded', data: updatedDocument });
  } catch (error) {
    console.error('Upload version error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ VERSIONS ============
export const getDocumentVersions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findFirst({
      where: {
        id,
        OR: [
          { uploadedBy: userId },
          {
            shares: {
              some: {
                userId,
                accessLevel: { in: ['VIEWER', 'DOWNLOADER', 'EDITOR'] },
              },
            },
          },
        ],
      },
    });

    if (!document) {
      res.status(404).json({ success: false, message: 'Not found or access denied' });
      return;
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { versionNumber: 'desc' },
    });

    res.json({ success: true, data: versions });
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const getVersionHistory = getDocumentVersions;

// ============ DELETE ============
export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    const versions = await prisma.documentVersion.findMany({ where: { documentId: id } });
    for (const v of versions) {
      if (v.s3FileKey && fs.existsSync(v.s3FileKey)) {
        try {
          fs.unlinkSync(v.s3FileKey);
        } catch (e) {
          console.error('Failed to delete file:', v.s3FileKey, e);
        }
      }
    }

    await prisma.document.delete({ where: { id } });

    await logActivityWithRequest(
      req,
      userId,
      'DELETE_DOCUMENT',
      { title: document.title },
      'DOCUMENT',
      id
    );

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ ALIAS untuk routes lama ============
export const createDocument = uploadDocument;
export const getDocumentById = getDocumentDetail;