import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { logActivity, getClientIp } from '../utils/activityLogger.js';

interface AuthRequest extends Request {
  user?: {
    id: string;      
    email?: string;
    name?: string;
    role: string;
    companyId?: string | null;
  };
}

const VALID_ACCESS_LEVELS = ['VIEWER', 'DOWNLOADER', 'EDITOR'];

// Helper: Super Admin & Company Admin bebas,
// Employee hanya boleh mengelola share untuk dokumen yang folder induknya milik dia.
function canManageShare(
  userRole: string,
  userId: string,
  folderOwnerId: string
): boolean {
  if (userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN') return true;
  return userId === folderOwnerId;
}

// 1. FUNGSI MEMBAGIKAN DOKUMEN KE USER LAIN
export const shareDocument = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const documentId = req.params.id as string;
    const { user_id, access_level } = req.body;

    if (!user_id || typeof user_id !== 'string') {
      res.status(400).json({ message: 'user_id penerima akses wajib diisi.' });
      return;
    }

    const level = access_level || 'VIEWER';
    if (!VALID_ACCESS_LEVELS.includes(level)) {
      res.status(400).json({
        message: `access_level tidak valid. Pilih salah satu: ${VALID_ACCESS_LEVELS.join(', ')}.`,
      });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { folder: true },
    });
    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (
      !canManageShare(
        req.user!.role,
        req.user!.id,
        document.folder.ownerId   // ✅ ownerId (camelCase)
      )
    ) {
      res
        .status(403)
        .json({ message: 'Anda tidak memiliki izin untuk membagikan dokumen ini.' });
      return;
    }

    // Cegah berbagi dokumen ke diri sendiri
    if (user_id === req.user!.id) {
      res
        .status(400)
        .json({ message: 'Tidak dapat membagikan dokumen ke akun Anda sendiri.' });
      return;
    }

    const targetUser = await prisma.user.findUnique({ where: { id: user_id } });
    if (!targetUser) {
      res.status(404).json({ message: 'Pengguna tujuan tidak ditemukan.' });
      return;
    }

    // Cek apakah sudah pernah dibagikan — kalau ada, update; kalau belum, create.
    const existingShare = await prisma.documentShare.findFirst({
      where: {
        documentId,   // ✅ documentId
        userId: user_id,   // ✅ userId
      },
    });

    let share;
    if (existingShare) {
      share = await prisma.documentShare.update({
        where: { id: existingShare.id },
        data: { accessLevel: level },   // ✅ accessLevel
      });
    } else {
      share = await prisma.documentShare.create({
        data: {
          documentId,               // ✅ documentId
          userId: user_id,          // ✅ userId
          accessLevel: level,       // ✅ accessLevel
          sharedBy: req.user!.id,   // ✅ wajib: sharedBy
        },
      });
    }

    await logActivity({
      userId: req.user!.id,
      action: 'SHARE_DOCUMENT',
      details: `Membagikan dokumen "${document.title}" (ID: ${documentId}) ke user ${targetUser.email} dengan akses ${level}`,
      ipAddress: getClientIp(req),
    });

    res.status(existingShare ? 200 : 201).json({
      message: existingShare
        ? 'Level akses berbagi berhasil diperbarui.'
        : 'Dokumen berhasil dibagikan.',
      share,
    });
  } catch (error) {
    console.error('Share Document Error:', error);
    res
      .status(500)
      .json({ message: 'Terjadi kegagalan server saat membagikan dokumen.' });
  }
};

// 2. FUNGSI MELIHAT DAFTAR USER YANG DIBAGIKAN AKSES UNTUK SATU DOKUMEN
export const getDocumentShares = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const documentId = req.params.id as string;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { folder: true },
    });
    if (!document) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (
      !canManageShare(
        req.user!.role,
        req.user!.id,
        document.folder.ownerId   // ✅ ownerId
      )
    ) {
      res.status(403).json({
        message: 'Anda tidak memiliki izin untuk melihat daftar akses dokumen ini.',
      });
      return;
    }

    const shares = await prisma.documentShare.findMany({
      where: { documentId },   // ✅ documentId
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },   // ✅ createdAt
    });

    res.status(200).json({ documentId, shares });
  } catch (error) {
    console.error('Get Document Shares Error:', error);
    res.status(500).json({
      message: 'Terjadi kegagalan server saat mengambil daftar akses dokumen.',
    });
  }
};

// 3. FUNGSI MELIHAT DOKUMEN YANG DIBAGIKAN KEPADA SAYA
export const getSharedWithMe = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const shares = await prisma.documentShare.findMany({
      where: { userId: req.user!.id },   // ✅ userId
      include: {
        document: {
          select: {
            id: true,
            title: true,
            extension: true,
            status: true,
            currentVersion: true,   // ✅ currentVersion
            updatedAt: true,        // ✅ updatedAt
          },
        },
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },   // ✅ createdAt
    });

    res.status(200).json({ shares });
  } catch (error) {
    console.error('Get Shared With Me Error:', error);
    res.status(500).json({
      message: 'Terjadi kegagalan server saat mengambil dokumen yang dibagikan.',
    });
  }
};

// 4. FUNGSI MENGUBAH LEVEL AKSES BERBAGI
export const updateShareAccess = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const shareId = req.params.shareId as string;
    const { access_level } = req.body;

    if (!access_level || !VALID_ACCESS_LEVELS.includes(access_level)) {
      res.status(400).json({
        message: `access_level tidak valid. Pilih salah satu: ${VALID_ACCESS_LEVELS.join(', ')}.`,
      });
      return;
    }

    const share = await prisma.documentShare.findUnique({
      where: { id: shareId },
      include: { document: { include: { folder: true } } },
    });
    if (!share) {
      res.status(404).json({ message: 'Data akses berbagi tidak ditemukan.' });
      return;
    }

    if (
      !canManageShare(
        req.user!.role,
        req.user!.id,
        share.document.folder.ownerId   // ✅ ownerId
      )
    ) {
      res
        .status(403)
        .json({ message: 'Anda tidak memiliki izin untuk mengubah akses ini.' });
      return;
    }

    const updated = await prisma.documentShare.update({
      where: { id: shareId },
      data: { accessLevel: access_level },   // ✅ accessLevel
    });

    await logActivity({
      userId: req.user!.id,
      action: 'UPDATE_SHARE_ACCESS',
      details: `Mengubah level akses share (ID: ${shareId}) menjadi ${access_level}`,
      ipAddress: getClientIp(req),
    });

    res
      .status(200)
      .json({ message: 'Level akses berhasil diperbarui.', share: updated });
  } catch (error) {
    console.error('Update Share Access Error:', error);
    res.status(500).json({
      message: 'Terjadi kegagalan server saat memperbarui akses berbagi.',
    });
  }
};

// 5. FUNGSI MENCABUT AKSES BERBAGI (REVOKE)
export const revokeShare = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const shareId = req.params.shareId as string;

    const share = await prisma.documentShare.findUnique({
      where: { id: shareId },
      include: { document: { include: { folder: true } } },
    });
    if (!share) {
      res.status(404).json({ message: 'Data akses berbagi tidak ditemukan.' });
      return;
    }

    if (
      !canManageShare(
        req.user!.role,
        req.user!.id,
        share.document.folder.ownerId   // ✅ ownerId
      )
    ) {
      res
        .status(403)
        .json({ message: 'Anda tidak memiliki izin untuk mencabut akses ini.' });
      return;
    }

    await logActivity({
      userId: req.user!.id,
      action: 'REVOKE_SHARE',
      details: `Mencabut akses share (ID: ${shareId}) untuk dokumen "${share.document.title}"`,
      ipAddress: getClientIp(req),
    });

    await prisma.documentShare.delete({ where: { id: shareId } });

    res.status(200).json({ message: 'Akses berbagi berhasil dicabut.' });
  } catch (error) {
    console.error('Revoke Share Error:', error);
    res
      .status(500)
      .json({ message: 'Terjadi kegagalan server saat mencabut akses berbagi.' });
  }
};