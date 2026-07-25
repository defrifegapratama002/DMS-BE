import type { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { logActivity, getClientIp } from '../utils/activityLogger.js';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

function canModifyDocument(userRole: string, userId: string, folderOwnerId: string): boolean {
  if (userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN') return true;
  return userId === folderOwnerId;
}

// Helper BARU: menentukan apakah user boleh MELIHAT dokumen (lebih longgar dari canModifyDocument,
// karena mencakup akses via DocumentShare dan role AUDITOR yang read-only).
async function canViewDocument(
  userRole: string,
  userId: string,
  folderOwnerId: string,
  documentId: string
): Promise<boolean> {
  if (userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN' || userRole === 'AUDITOR') return true;
  if (userId === folderOwnerId) return true;

  const share = await prisma.documentShare.findFirst({
    where: { document_id: documentId, user_id: userId },
  });
  return share !== null;
}

// 1. FUNGSI MEMBUAT DOKUMEN BARU (DRAFT)
export const createDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, extension, size_bytes, folder_id } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ message: 'Judul dokumen wajib diisi.' });
      return;
    }
    if (!extension || typeof extension !== 'string') {
      res.status(400).json({ message: 'Ekstensi berkas wajib diisi.' });
      return;
    }
    if (size_bytes === undefined || size_bytes === null || isNaN(Number(size_bytes))) {
      res.status(400).json({ message: 'Ukuran berkas (size_bytes) wajib diisi dan berupa angka.' });
      return;
    }
    if (!folder_id || typeof folder_id !== 'string') {
      res.status(400).json({ message: 'folder_id wajib diisi.' });
      return;
    }

    const folder = await prisma.folder.findUnique({ where: { id: folder_id } });
    if (!folder) {
      res.status(404).json({ message: 'Folder tujuan tidak ditemukan.' });
      return;
    }

    if (!canModifyDocument(req.user!.role, req.user!.userId, folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk menambah dokumen di folder ini.' });
      return;
    }

    const placeholderKey = `pending-upload/${crypto.randomUUID()}.${extension}`;

    const newDocument = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          title: title.trim(),
          extension,
          size_bytes: BigInt(size_bytes),
          folder_id,
          current_version: 1,
          status: 'DRAFT',
        },
      });

      await tx.documentVersion.create({
        data: {
          document_id: document.id,
          version_number: 1,
          s3_file_key: placeholderKey,
          uploaded_by: req.user!.userId,
          changelog: 'Versi awal dokumen.',
        },
      });

      return document;
    });

    await logActivity({
        userId: req.user!.userId,
        action: 'CREATE_DOCUMENT',
        details: `Membuat dokumen "${newDocument.title}" (ID: ${newDocument.id}) di folder ${folder_id}`,
        ipAddress: getClientIp(req),
        });

    res.status(201).json({
      message: 'Dokumen berhasil dibuat. Menunggu integrasi upload berkas ke Object Storage.',
      document: {
        ...newDocument,
        size_bytes: newDocument.size_bytes.toString(),
      },
    });
  } catch (error) {
    console.error('Create Document Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat membuat dokumen.' });
  }
};

// 2. FUNGSI MELIHAT DETAIL DOKUMEN — DIPERBARUI dengan pengecekan DocumentShare
export const getDocumentById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version_number: 'desc' } },
        folder: true,
      },
    });

    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    const allowed = await canViewDocument(
      req.user!.role,
      req.user!.userId,
      document.folder.owner_id,
      document.id
    );

    if (!allowed) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk melihat dokumen ini.' });
      return;
    }

    res.status(200).json({
      document: {
        ...document,
        size_bytes: document.size_bytes.toString(),
      },
    });
  } catch (error) {
    console.error('Get Document Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengambil detail dokumen.' });
  }
};

// ... renameDocument, uploadNewVersion tetap sama (pakai canModifyDocument) ...
export const renameDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { title } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ message: 'Judul dokumen baru wajib diisi.' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: { folder: true },
    });

    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (!canModifyDocument(req.user!.role, req.user!.userId, document.folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengubah dokumen ini.' });
      return;
    }

    const updated = await prisma.document.update({
      where: { id },
      data: { title: title.trim() },
    });

    await logActivity({
        userId: req.user!.userId,
        action: 'RENAME_DOCUMENT',
        details: `Mengganti judul dokumen "${document.title}" menjadi "${updated.title}" (ID: ${id})`,
        ipAddress: getClientIp(req),
        });

    res.status(200).json({
      message: 'Judul dokumen berhasil diperbarui.',
      document: { ...updated, size_bytes: updated.size_bytes.toString() },
    });
  } catch (error) {
    console.error('Rename Document Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengubah judul dokumen.' });
  }
};

export const uploadNewVersion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { size_bytes, changelog, extension } = req.body;

    if (size_bytes === undefined || size_bytes === null || isNaN(Number(size_bytes))) {
      res.status(400).json({ message: 'Ukuran berkas (size_bytes) wajib diisi dan berupa angka.' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: { folder: true },
    });

    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (!canModifyDocument(req.user!.role, req.user!.userId, document.folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengunggah versi baru dokumen ini.' });
      return;
    }

    const newVersionNumber = document.current_version + 1;
    const placeholderKey = `pending-upload/${crypto.randomUUID()}.${extension || document.extension}`;

    const updatedDocument = await prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          document_id: id,
          version_number: newVersionNumber,
          s3_file_key: placeholderKey,
          uploaded_by: req.user!.userId,
          changelog: changelog || null,
        },
      });

      return tx.document.update({
        where: { id },
        data: {
          current_version: newVersionNumber,
          size_bytes: BigInt(size_bytes),
          extension: extension || document.extension,
          status: 'PENDING_REVIEW',
        },
      });
    });

    await logActivity({
        userId: req.user!.userId,
        action: 'UPLOAD_VERSION',
        details: `Mengunggah versi baru (v${newVersionNumber}) untuk dokumen "${document.title}" (ID: ${id})`,
        ipAddress: getClientIp(req),
        });

    res.status(201).json({
      message: `Versi baru (v${newVersionNumber}) berhasil ditambahkan.`,
      document: { ...updatedDocument, size_bytes: updatedDocument.size_bytes.toString() },
    });
  } catch (error) {
    console.error('Upload New Version Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengunggah versi baru.' });
  }
};

// 5. FUNGSI MELIHAT RIWAYAT VERSI — DIPERBARUI dengan pengecekan yang sama seperti getDocumentById
export const getVersionHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const document = await prisma.document.findUnique({
      where: { id },
      include: { folder: true },
    });
    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    const allowed = await canViewDocument(
      req.user!.role,
      req.user!.userId,
      document.folder.owner_id,
      document.id
    );

    if (!allowed) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk melihat riwayat dokumen ini.' });
      return;
    }

    const versions = await prisma.documentVersion.findMany({
      where: { document_id: id },
      orderBy: { version_number: 'desc' },
    });

    res.status(200).json({ documentId: id, versions });
  } catch (error) {
    console.error('Get Version History Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengambil riwayat versi.' });
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const document = await prisma.document.findUnique({
      where: { id },
      include: { folder: true },
    });

    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (!canModifyDocument(req.user!.role, req.user!.userId, document.folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus dokumen ini.' });
      return;
    }

    await logActivity({
        userId: req.user!.userId,
        action: 'DELETE_DOCUMENT',
        details: `Menghapus dokumen "${document.title}" (ID: ${id})`,
        ipAddress: getClientIp(req),
        });

    await prisma.document.delete({ where: { id } });

    res.status(200).json({ message: 'Dokumen berhasil dihapus.' });
  } catch (error) {
    console.error('Delete Document Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat menghapus dokumen.' });
  }
};