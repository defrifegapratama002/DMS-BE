import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import {
  validateTransition,
  getActionForTransition,
  type DocumentStatus,
} from '../lib/workflow.js';
import { runAutomation } from '../lib/automation.js';
import {
  canDownloadDocument,
  canEditDocument,
  canReadDocument,
  isAdmin,
  isDocumentOwner,
  shareLevelFor,
  visibleDocumentsWhere,
} from '../utils/access.js';
import { extractText, mimeForExtension, sha256File } from '../utils/fileInfo.js';

// ============ Validation ============
const createDocumentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  folderId: z.string().uuid(),
  // multipart → string; "true" = pengguna sudah mengonfirmasi unggah berkas identik
  allowDuplicate: z.string().optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  // ✅ `status` dihapus — ubah status HARUS lewat PATCH /:id/status
});

const moveDocumentSchema = z.object({
  folderId: z.string().uuid(),
});

/** Relasi yang dibutuhkan daftar & kartu dokumen di FE. */
const LIST_INCLUDE = {
  folder: { select: { id: true, name: true, ownerId: true } },
  documentTags: { include: { tag: true } },
  documentType: true,
  correspondent: true,
} satisfies Prisma.DocumentInclude;

/** Relasi minimum untuk cek akses. */
const ACCESS_INCLUDE = {
  folder: { select: { id: true, name: true, ownerId: true } },
  shares: { select: { userId: true, accessLevel: true } },
} satisfies Prisma.DocumentInclude;

function removeFile(filePath?: string | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('Failed to delete file:', filePath, e);
  }
}

// ============ GET ALL (exclude trash) ============
export const getDocuments = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const user = req.user!;
    const { folderId, search, status, page = 1, limit = 10 } = req.query;

    const where: Prisma.DocumentWhereInput = { AND: [visibleDocumentsWhere(user)] };
    const and = where.AND as Prisma.DocumentWhereInput[];

    if (folderId) and.push({ folderId: folderId as string });
    if (status) and.push({ status: status as DocumentStatus });

    if (search) {
      and.push({
        OR: [
          { title: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
        ],
      });
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        // contentText bisa besar — jangan ikut di daftar
        omit: { contentText: true },
        include: {
          ...LIST_INCLUDE,
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
            where: { userId: user.id },
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
      const userShare = doc.shares.find((s) => s.userId === user.id);
      return {
        ...doc,
        accessLevel: userShare?.accessLevel || null,
        isOwner: doc.uploadedBy === user.id,
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
  const file = (req as any).file as Express.Multer.File | undefined;
  try {
    const user = req.user!;
    const userId = user.id;
    const validated = createDocumentSchema.parse(req.body);

    if (!file) {
      res.status(400).json({ success: false, message: 'File is required' });
      return;
    }

    // Admin boleh mengunggah ke folder mana pun; selain itu hanya ke folder miliknya.
    const folder = await prisma.folder.findFirst({
      where: isAdmin(user.role)
        ? { id: validated.folderId }
        : { id: validated.folderId, ownerId: userId },
    });

    if (!folder) {
      removeFile(file.path);
      res
        .status(404)
        .json({ success: false, message: 'Folder not found or not owned' });
      return;
    }

    // Deteksi duplikat: berkas identik (SHA-256) yang masih aktif.
    const checksum = await sha256File(file.path);
    if (validated.allowDuplicate !== 'true') {
      const twin = await prisma.documentVersion.findFirst({
        where: { checksum, document: { deletedAt: null } },
        include: {
          document: {
            select: { id: true, title: true, folder: { select: { name: true } } },
          },
        },
      });
      if (twin) {
        removeFile(file.path);
        res.status(409).json({
          success: false,
          code: 'DUPLICATE_DOCUMENT',
          message: `Berkas identik sudah ada: "${twin.document.title}" di folder ${twin.document.folder.name}.`,
          data: {
            existing: {
              id: twin.document.id,
              title: twin.document.title,
              folderName: twin.document.folder.name,
            },
          },
        });
        return;
      }
    }

    const extension = path.extname(file.originalname).slice(1).toLowerCase();

    const created = await prisma.document.create({
      data: {
        title: validated.title,
        extension,
        sizeBytes: BigInt(file.size),
        folderId: validated.folderId,
        description: validated.description || '',
        uploadedBy: userId,
        currentVersion: 1,
        status: 'DRAFT',
        contentText: await extractText(file.path, extension),
        versions: {
          create: {
            versionNumber: 1,
            s3FileKey: file.path,
            fileSize: BigInt(file.size),
            mimeType: file.mimetype,
            checksum,
            originalName: file.originalname,
            uploadedBy: userId,
            changelog: 'Initial upload',
          },
        },
      },
    });

    await logActivityWithRequest(
      req,
      userId,
      'CREATE_DOCUMENT',
      {
        title: created.title,
        fileName: file.originalname,
        fileSize: file.size,
        version: 1,
      },
      'DOCUMENT',
      created.id
    );

    const appliedRules = await runAutomation(req, userId, 'upload', created);

    const document = await prisma.document.findUnique({
      where: { id: created.id },
      omit: { contentText: true },
      include: {
        ...LIST_INCLUDE,
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: { ...document, appliedRules },
    });
  } catch (error) {
    removeFile(file?.path);
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
    const user = req.user!;
    const userId = user.id;

    const document = await prisma.document.findUnique({
      where: { id },
      omit: { contentText: true },
      include: {
        folder: true,
        uploadedByUser: { select: { id: true, name: true, email: true, role: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
        shares: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        documentType: true,
        correspondent: true,
        documentTags: { include: { tag: true } },
      },
    });

    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (document.deletedAt) {
      res.status(404).json({
        success: false,
        message: 'Document not found (in trash)',
      });
      return;
    }

    if (!canReadDocument(document, user)) {
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
          isOwner: isDocumentOwner(document, userId),
          accessLevel: shareLevelFor(document, userId),
          canEdit: canEditDocument(document, user),
          canDownload: canDownloadDocument(document, user),
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
    const user = req.user!;
    const validated = updateDocumentSchema.parse(req.body);

    const existing = await prisma.document.findUnique({
      where: { id },
      include: ACCESS_INCLUDE,
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (existing.deletedAt) {
      res.status(400).json({
        success: false,
        message: 'Cannot update a document in trash. Restore it first.',
      });
      return;
    }

    if (!canEditDocument(existing, user)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const updated = await prisma.document.update({
      where: { id },
      data: validated,
      omit: { contentText: true },
      include: LIST_INCLUDE,
    });

    await logActivityWithRequest(
      req,
      user.id,
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

// ============ MOVE ============
export const moveDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = req.user!;
    const { folderId } = moveDocumentSchema.parse(req.body);

    const existing = await prisma.document.findUnique({
      where: { id },
      include: ACCESS_INCLUDE,
    });
    if (!existing || existing.deletedAt) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (!canEditDocument(existing, user)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const target = await prisma.folder.findFirst({
      where: isAdmin(user.role) ? { id: folderId } : { id: folderId, ownerId: user.id },
    });
    if (!target) {
      res.status(404).json({ success: false, message: 'Target folder not found' });
      return;
    }

    const updated = await prisma.document.update({
      where: { id },
      data: { folderId },
      omit: { contentText: true },
      include: LIST_INCLUDE,
    });

    await logActivityWithRequest(
      req,
      user.id,
      'MOVE_DOCUMENT',
      { title: existing.title, from: existing.folder.name, to: target.name },
      'DOCUMENT',
      id
    );

    res.json({ success: true, message: 'Document moved', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Move document error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ UPLOAD NEW VERSION ============
export const uploadNewVersion = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const file = (req as any).file as Express.Multer.File | undefined;
  try {
    const id = req.params.id as string;
    const user = req.user!;
    const userId = user.id;
    const { changelog } = req.body;

    if (!file) {
      res.status(400).json({ success: false, message: 'File is required' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: ACCESS_INCLUDE,
    });

    if (!document) {
      removeFile(file.path);
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (document.deletedAt) {
      removeFile(file.path);
      res.status(400).json({
        success: false,
        message: 'Cannot upload version to a document in trash',
      });
      return;
    }

    if (!canEditDocument(document, user)) {
      removeFile(file.path);
      res.status(403).json({
        success: false,
        message: 'Access denied. EDITOR access required.',
      });
      return;
    }

    const newVersion = document.currentVersion + 1;
    const extension =
      path.extname(file.originalname).slice(1).toLowerCase() || document.extension;
    const checksum = await sha256File(file.path);

    const updatedDocument = await prisma.document.update({
      where: { id },
      data: {
        currentVersion: newVersion,
        extension,
        sizeBytes: BigInt(file.size),
        contentText: await extractText(file.path, extension),
        versions: {
          create: {
            versionNumber: newVersion,
            s3FileKey: file.path,
            fileSize: BigInt(file.size),
            mimeType: file.mimetype,
            checksum,
            originalName: file.originalname,
            uploadedBy: userId,
            changelog: changelog || 'New version uploaded',
          },
        },
      },
      omit: { contentText: true },
      include: {
        ...LIST_INCLUDE,
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
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
    removeFile(file?.path);
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
    const user = req.user!;

    const document = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: ACCESS_INCLUDE,
    });

    if (!document || !canReadDocument(document, user)) {
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

// ============ FILE (pratinjau / unduh) ============
// GET /:id/file?version=2&download=1
export const getDocumentFile = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = req.user!;
    const isDownload = req.query.download === '1' || req.query.download === 'true';

    const document = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: ACCESS_INCLUDE,
    });

    if (!document || !canReadDocument(document, user)) {
      res.status(404).json({ success: false, message: 'Not found or access denied' });
      return;
    }

    if (isDownload && !canDownloadDocument(document, user)) {
      res.status(403).json({
        success: false,
        message: 'Akses Anda hanya untuk melihat, tidak untuk mengunduh.',
      });
      return;
    }

    const versionNumber = req.query.version
      ? Number(req.query.version)
      : document.currentVersion;
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: id, versionNumber } },
    });

    if (!version) {
      res.status(404).json({ success: false, message: 'Version not found' });
      return;
    }

    const absolute = path.resolve(version.s3FileKey);
    if (!fs.existsSync(absolute)) {
      res.status(404).json({ success: false, message: 'File tidak ditemukan di storage' });
      return;
    }

    if (isDownload) {
      await logActivityWithRequest(
        req,
        user.id,
        'DOWNLOAD_DOCUMENT',
        { title: document.title, version: versionNumber },
        'DOCUMENT',
        id
      );
    }

    const ext = path.extname(version.s3FileKey).slice(1) || document.extension;
    const suffix = versionNumber === document.currentVersion ? '' : ` (v${versionNumber})`;
    const filename = `${document.title}${suffix}.${ext}`;

    res.setHeader('Content-Type', mimeForExtension(ext));
    res.setHeader(
      'Content-Disposition',
      `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(absolute).pipe(res);
  } catch (error) {
    console.error('Get document file error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ KONTEN TERINDEKS ============
export const getDocumentContent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const document = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: ACCESS_INCLUDE,
    });

    if (!document || !canReadDocument(document, req.user!)) {
      res.status(404).json({ success: false, message: 'Not found or access denied' });
      return;
    }

    res.json({ success: true, data: { content: document.contentText ?? null } });
  } catch (error) {
    console.error('Get document content error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ RIWAYAT AKTIVITAS SATU DOKUMEN ============
export const getDocumentHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const document = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: ACCESS_INCLUDE,
    });

    if (!document || !canReadDocument(document, req.user!)) {
      res.status(404).json({ success: false, message: 'Not found or access denied' });
      return;
    }

    const logs = await prisma.activityLog.findMany({
      where: {
        documentId: id,
        // "dilihat" terlalu bising untuk riwayat
        action: { not: 'VIEW_DOCUMENT' },
      },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Get document history error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ DOKUMEN MIRIP ============
// Skor: tag sama (+2/tag), tipe sama (+2), pihak sama (+2), folder sama (+1).
export const getSimilarDocuments = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = req.user!;

    const source = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: { ...ACCESS_INCLUDE, documentTags: true },
    });
    if (!source || !canReadDocument(source, user)) {
      res.status(404).json({ success: false, message: 'Not found or access denied' });
      return;
    }

    const tagIds = source.documentTags.map((t) => t.tagId);
    const or: Prisma.DocumentWhereInput[] = [{ folderId: source.folderId }];
    if (tagIds.length > 0) or.push({ documentTags: { some: { tagId: { in: tagIds } } } });
    if (source.documentTypeId) or.push({ documentTypeId: source.documentTypeId });
    if (source.correspondentId) or.push({ correspondentId: source.correspondentId });

    const candidates = await prisma.document.findMany({
      where: { AND: [visibleDocumentsWhere(user), { id: { not: id } }, { OR: or }] },
      omit: { contentText: true },
      include: LIST_INCLUDE,
      take: 200,
    });

    const scored = candidates
      .map((d) => {
        const sharedTags = d.documentTags.filter((t) => tagIds.includes(t.tagId)).length;
        const score =
          sharedTags * 2 +
          (source.documentTypeId && d.documentTypeId === source.documentTypeId ? 2 : 0) +
          (source.correspondentId && d.correspondentId === source.correspondentId ? 2 : 0) +
          (d.folderId === source.folderId ? 1 : 0);
        return { ...d, score };
      })
      .filter((d) => d.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    res.json({ success: true, data: scored });
  } catch (error) {
    console.error('Get similar documents error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ DELETE (soft delete → trash) ============
export const deleteDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = req.user!;

    const document = await prisma.document.findUnique({
      where: { id },
      include: ACCESS_INCLUDE,
    });
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

    if (!isAdmin(user.role) && !isDocumentOwner(document, user.id)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    await prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logActivityWithRequest(
      req,
      user.id,
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

/** Sampah: admin melihat semuanya; selain itu hanya miliknya. */
function trashWhere(user: { id: string; role: string }): Prisma.DocumentWhereInput {
  if (isAdmin(user.role)) return { deletedAt: { not: null } };
  return {
    deletedAt: { not: null },
    OR: [{ uploadedBy: user.id }, { folder: { ownerId: user.id } }],
  };
}

// ============ GET TRASH ============
export const getTrash = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const documents = await prisma.document.findMany({
      where: trashWhere(req.user!),
      omit: { contentText: true },
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
    const user = req.user!;

    const document = await prisma.document.findUnique({
      where: { id },
      include: ACCESS_INCLUDE,
    });
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

    if (!isAdmin(user.role) && !isDocumentOwner(document, user.id)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const restored = await prisma.document.update({
      where: { id },
      data: { deletedAt: null },
      omit: { contentText: true },
      include: LIST_INCLUDE,
    });

    await logActivityWithRequest(
      req,
      user.id,
      'RESTORE_DOCUMENT',
      { title: document.title },
      'DOCUMENT',
      id
    );

    res.json({
      success: true,
      message: 'Document restored successfully',
      data: restored,
    });
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

    if (!document.deletedAt) {
      res.status(400).json({
        success: false,
        message: 'Document must be in trash before permanent delete',
      });
      return;
    }

    for (const v of document.versions) removeFile(v.s3FileKey);

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
      where: trashWhere(req.user!),
      include: { versions: true },
    });

    for (const doc of documents) {
      for (const v of doc.versions) removeFile(v.s3FileKey);
    }

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

// ============ UPDATE STATUS (workflow) ============
export const updateDocumentStatus = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const { status: newStatus, reason } = req.body;

    if (!newStatus) {
      res.status(400).json({ success: false, message: 'status wajib diisi' });
      return;
    }

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ success: false, message: 'Document not found' });
      return;
    }

    if (document.deletedAt) {
      res.status(400).json({
        success: false,
        message: 'Tidak bisa ubah status dokumen di trash',
      });
      return;
    }

    const currentStatus = document.status as DocumentStatus;
    const targetStatus = newStatus as DocumentStatus;

    const action = getActionForTransition(currentStatus, targetStatus, {
      userId,
      userRole,
      documentOwnerId: document.uploadedBy,
      hasReason: !!(reason && reason.trim()),
    });
    if (!action) {
      res.status(400).json({
        success: false,
        message: `Transisi dari ${currentStatus} ke ${targetStatus} tidak valid`,
      });
      return;
    }

    const validation = validateTransition({
      action,
      currentStatus,
      userRole,
      userId,
      documentOwnerId: document.uploadedBy,
      reason,
    });

    if (!validation.valid) {
      res.status(403).json({ success: false, message: validation.error });
      return;
    }

    await prisma.document.update({
      where: { id },
      data: { status: targetStatus },
    });

    await logActivityWithRequest(
      req,
      userId,
      action, // ✅ sudah type-safe
      {
        title: document.title,
        from: currentStatus,
        to: targetStatus,
        ...(reason && { reason }),
      },
      'DOCUMENT',
      id
    );

    // Alasan penolakan ikut jadi catatan dokumen agar terlihat di tab Catatan.
    if (reason && String(reason).trim()) {
      await prisma.documentNote.create({
        data: {
          documentId: id,
          userId,
          body: `[${action === 'REJECT' ? 'Ditolak' : 'Status'}] ${String(reason).trim()}`,
        },
      });
    }

    const appliedRules = await runAutomation(req, userId, 'status_change', document, {
      newStatus: targetStatus,
    });

    const updated = await prisma.document.findUnique({
      where: { id },
      omit: { contentText: true },
      include: LIST_INCLUDE,
    });

    res.json({
      success: true,
      message: `Status berubah: ${currentStatus} → ${targetStatus}`,
      data: { ...updated, appliedRules },
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============ ALIAS untuk routes lama ============
export const createDocument = uploadDocument;
export const getDocumentById = getDocumentDetail;
