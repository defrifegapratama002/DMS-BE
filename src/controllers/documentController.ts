import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';

// ============ Validation ============
const createDocumentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  folderId: z.string().uuid(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z
    .enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED'])
    .optional(),
});

// ============ GET ALL (exclude trash) ============
export const getDocuments = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { folderId, search, status, page = 1, limit = 10 } = req.query;

    const where: any = {
      deletedAt: null, // ✅ Exclude trashed documents
    };

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
            select: { accessLevel: true, userId: true },
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
export const uploadDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
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
      res
        .status(404)
        .json({ success: false, message: 'Folder not found or not owned' });
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
      {
        title: document.title,
        fileName: file.originalname,
        fileSize: file.size,
        version: 1,
      },
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
      res
        .status(400)
        .json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ DETAIL ============
export const getDocumentDetail = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
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

    // ✅ Trashed documents hanya bisa dilihat lewat endpoint /trash
    if (document.deletedAt) {
      res.status(404).json({
        success: false,
        message: 'Document not found (in trash)',
      });
      return;
    }

    const userShare = document.shares.find((s) => s.userId === userId);
    const hasAccess =
      document.uploadedBy === userId || userShare || document.status === 'APPROVED';

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
export const updateDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;
    const validated = updateDocumentSchema.parse(req.body);

    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    // ✅ Tidak bisa update dokumen di trash
    if (existing.deletedAt) {
      res.status(400).json({
        success: false,
        message: 'Cannot update a document in trash. Restore it first.',
      });
      return;
    }

    const userShare = await prisma.documentShare.findFirst({
      where: { documentId: id, userId, accessLevel: 'EDITOR' },
    });

    if (existing.uploadedBy !== userId && !userShare) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const updated = await prisma.document.update({
      where: { id },
      data: validated,
    });

    await logActivityWithRequest(
      req,
      userId,
      'RENAME_DOCUMENT',
      { title: updated.title, changes: validated },
      'DOCUMENT',
      updated.id
    );

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: updated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Update document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const renameDocument = updateDocument;

// ============ UPLOAD NEW VERSION ============
export const uploadNewVersion = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
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

    // ✅ Tidak bisa upload versi baru ke dokumen di trash
    if (document.deletedAt) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(400).json({
        success: false,
        message: 'Cannot upload version to a document in trash',
      });
      return;
    }

    const hasEditAccess =
      document.uploadedBy === userId || document.shares.length > 0;
    if (!hasEditAccess) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(403).json({
        success: false,
        message: 'Access denied. EDITOR access required.',
      });
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

    res.json({
      success: true,
      message: 'New version uploaded',
      data: updatedDocument,
    });
  } catch (error) {
    console.error('Upload version error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ VERSIONS ============
export const getDocumentVersions = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findFirst({
      where: {
        id,
        deletedAt: null, // ✅ Exclude trashed
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
      res
        .status(404)
        .json({ success: false, message: 'Not found or access denied' });
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

// ============ DELETE (soft delete → trash) ============
export const deleteDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (document.deletedAt) {
      res
        .status(400)
        .json({ success: false, message: 'Document is already in trash' });
      return;
    }

    // Soft delete: set deletedAt
    await prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logActivityWithRequest(
      req,
      userId,
      'DELETE_DOCUMENT',
      { title: document.title, mode: 'soft-delete' },
      'DOCUMENT',
      id
    );

    res.json({ success: true, message: 'Document moved to trash' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ GET TRASH ============
export const getTrash = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const documents = await prisma.document.findMany({
      where: {
        deletedAt: { not: null },
        OR: [{ uploadedBy: userId }, { folder: { ownerId: userId } }],
      },
      include: {
        folder: { select: { id: true, name: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });

    res.json({ success: true, data: documents });
  } catch (error) {
    console.error('Get trash error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ RESTORE FROM TRASH ============
export const restoreDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (!document.deletedAt) {
      res
        .status(400)
        .json({ success: false, message: 'Document is not in trash' });
      return;
    }

    await prisma.document.update({
      where: { id },
      data: { deletedAt: null },
    });

    await logActivityWithRequest(
      req,
      userId,
      'RESTORE_DOCUMENT',
      { title: document.title },
      'DOCUMENT',
      id
    );

    res.json({ success: true, message: 'Document restored successfully' });
  } catch (error) {
    console.error('Restore document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ PERMANENT DELETE ============
export const purgeDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const document = await prisma.document.findUnique({
      where: { id },
      include: { versions: true },
    });

    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    // Hanya bisa purge dokumen yang ada di trash
    if (!document.deletedAt) {
      res.status(400).json({
        success: false,
        message: 'Document must be in trash before permanent delete',
      });
      return;
    }

    // Delete physical files
    for (const v of document.versions) {
      if (v.s3FileKey && fs.existsSync(v.s3FileKey)) {
        try {
          fs.unlinkSync(v.s3FileKey);
        } catch (e) {
          console.error('Failed to delete file:', v.s3FileKey, e);
        }
      }
    }

    // Cascade delete (versions, shares, documentTags, notes)
    await prisma.document.delete({ where: { id } });

    await logActivityWithRequest(
      req,
      userId,
      'DELETE_DOCUMENT',
      { title: document.title, mode: 'permanent' },
      'DOCUMENT',
      id
    );

    res.json({ success: true, message: 'Document permanently deleted' });
  } catch (error) {
    console.error('Purge document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ EMPTY TRASH ============
export const emptyTrash = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const documents = await prisma.document.findMany({
      where: {
        deletedAt: { not: null },
        OR: [{ uploadedBy: userId }, { folder: { ownerId: userId } }],
      },
      include: { versions: true },
    });

    // Delete all physical files
    for (const doc of documents) {
      for (const v of doc.versions) {
        if (v.s3FileKey && fs.existsSync(v.s3FileKey)) {
          try {
            fs.unlinkSync(v.s3FileKey);
          } catch (e) {
            console.error('Failed to delete file:', v.s3FileKey, e);
          }
        }
      }
    }

    // Delete from DB
    await prisma.document.deleteMany({
      where: { id: { in: documents.map((d) => d.id) } },
    });

    await logActivityWithRequest(
      req,
      userId,
      'DELETE_DOCUMENT',
      { count: documents.length, mode: 'empty-trash' },
      'DOCUMENT'
    );

    res.json({
      success: true,
      message: `${documents.length} documents permanently deleted`,
      data: { count: documents.length },
    });
  } catch (error) {
    console.error('Empty trash error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ ALIAS untuk routes lama ============
export const createDocument = uploadDocument;
export const getDocumentById = getDocumentDetail;