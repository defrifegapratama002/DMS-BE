import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { logActivity, getClientIp } from '../utils/activityLogger.js';  

// Tipe request yang sudah diperluas dengan payload user dari JWT
interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

// Helper: menentukan apakah user boleh memodifikasi folder tertentu.
// Super Admin & Company Admin bebas mengelola seluruh folder.
// Employee hanya boleh mengelola folder miliknya sendiri.
// Auditor tidak pernah lolos di sini (read-only) — sudah dibatasi juga di layer routes.
function canModifyFolder(userRole: string, userId: string, folderOwnerId: string): boolean {
  if (userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN') return true;
  return userId === folderOwnerId;
}

// 1. FUNGSI MEMBUAT FOLDER BARU
export const createFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, parent_folder_id } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ message: 'Nama folder wajib diisi.' });
      return;
    }

    // Validasi apakah parent folder benar-benar ada (jika disertakan)
    if (parent_folder_id) {
      const parentExists = await prisma.folder.findUnique({
        where: { id: parent_folder_id },
      });
      if (!parentExists) {
        res.status(404).json({ message: 'Folder induk tidak ditemukan.' });
        return;
      }
    }

    const newFolder = await prisma.folder.create({
      data: {
        name: name.trim(),
        parent_folder_id: parent_folder_id || null,
        owner_id: req.user!.userId,
      },
    });

    await logActivity({
        userId: req.user!.userId,
        action: 'CREATE_FOLDER',
        details: `Membuat folder "${newFolder.name}" (ID: ${newFolder.id})`,
        ipAddress: getClientIp(req),
        });

    res.status(201).json({
      message: 'Folder berhasil dibuat.',
      folder: newFolder,
    });
  } catch (error) {
    console.error('Create Folder Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat membuat folder.' });
  }
};

// 2. FUNGSI MELIHAT ISI FOLDER (SUB-FOLDER + DOKUMEN)
// Gunakan 'root' sebagai folderId di URL untuk menampilkan isi Root
export const getFolderContents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderId } = req.params as { folderId: string };
    const targetId = folderId === 'root' ? null : folderId;

    // Jika bukan root, pastikan folder tujuan memang ada
    if (targetId) {
      const folderExists = await prisma.folder.findUnique({ where: { id: targetId } });
      if (!folderExists) {
        res.status(404).json({ message: 'Folder tidak ditemukan.' });
        return;
      }
    }

    const [subFolders, documents] = await Promise.all([
      prisma.folder.findMany({
        where: { parent_folder_id: targetId },
        orderBy: { name: 'asc' },
      }),
      // Catatan: folder_id di model Document bersifat wajib (String, bukan String?).
      // Jika targetId null (Root), query ini hanya berjalan aman kalau kamu
      // memang punya folder Root nyata di database, atau kamu perlu logic khusus
      // untuk menampilkan dokumen di Root secara terpisah.
      targetId
        ? prisma.document.findMany({
            where: { folder_id: targetId },
            orderBy: { title: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    res.status(200).json({
      folderId: targetId,
      subFolders,
      documents,
    });
  } catch (error) {
    console.error('Get Folder Contents Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengambil isi folder.' });
  }
};

// 3. FUNGSI MENGGANTI NAMA FOLDER
export const renameFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ message: 'Nama folder baru wajib diisi.' });
      return;
    }

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder) {
      res.status(404).json({ message: 'Folder tidak ditemukan.' });
      return;
    }

    if (!canModifyFolder(req.user!.role, req.user!.userId, folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengubah folder ini.' });
      return;
    }

    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: { name: name.trim() },
    });
    await logActivity({
        userId: req.user!.userId,
        action: 'RENAME_FOLDER',
        details: `Mengganti nama folder "${folder.name}" menjadi "${updatedFolder.name}" (ID: ${id})`,
        ipAddress: getClientIp(req),
        });

    res.status(200).json({
      message: 'Nama folder berhasil diperbarui.',
      folder: updatedFolder,
    });
  } catch (error) {
    console.error('Rename Folder Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat mengganti nama folder.' });
  }
};

// 4. FUNGSI MEMINDAHKAN FOLDER (MENGUBAH PARENT)
export const moveFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { new_parent_folder_id } = req.body;

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder) {
      res.status(404).json({ message: 'Folder tidak ditemukan.' });
      return;
    }

    if (!canModifyFolder(req.user!.role, req.user!.userId, folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk memindahkan folder ini.' });
      return;
    }

    // Folder tidak boleh dipindahkan ke dalam dirinya sendiri
    if (new_parent_folder_id === id) {
      res.status(400).json({ message: 'Folder tidak dapat dipindahkan ke dalam dirinya sendiri.' });
      return;
    }

    // Cegah circular reference: folder tidak boleh dipindah ke dalam salah satu sub-foldernya sendiri
    if (new_parent_folder_id) {
      const targetParent = await prisma.folder.findUnique({
        where: { id: new_parent_folder_id },
      });
      if (!targetParent) {
        res.status(404).json({ message: 'Folder tujuan tidak ditemukan.' });
        return;
      }

      // Employee hanya boleh memindahkan folder ke dalam folder tujuan yang juga miliknya,
      // agar tidak bisa "menitipkan" folder ke area milik user lain.
      if (!canModifyFolder(req.user!.role, req.user!.userId, targetParent.owner_id)) {
        res.status(403).json({
          message: 'Anda tidak memiliki izin untuk memindahkan folder ke lokasi tujuan tersebut.',
        });
        return;
      }

      const isDescendant = await isFolderDescendant(id, new_parent_folder_id);
      if (isDescendant) {
        res.status(400).json({
          message: 'Folder tidak dapat dipindahkan ke dalam sub-foldernya sendiri.',
        });
        return;
      }
    }

    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: { parent_folder_id: new_parent_folder_id || null },
    });
    await logActivity({
        userId: req.user!.userId,
        action: 'MOVE_FOLDER',
        details: `Memindahkan folder "${folder.name}" (ID: ${id}) ke parent baru: ${new_parent_folder_id || 'Root'}`,
        ipAddress: getClientIp(req),
        });

    res.status(200).json({
      message: 'Folder berhasil dipindahkan.',
      folder: updatedFolder,
    });
  } catch (error) {
    console.error('Move Folder Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat memindahkan folder.' });
  }
};

// Helper rekursif: mengecek apakah `candidateParentId` adalah salah satu keturunan dari `folderId`
async function isFolderDescendant(folderId: string, candidateParentId: string): Promise<boolean> {
  const children = await prisma.folder.findMany({
    where: { parent_folder_id: folderId },
    select: { id: true },
  });

  for (const child of children) {
    if (child.id === candidateParentId) return true;
    const deeper = await isFolderDescendant(child.id, candidateParentId);
    if (deeper) return true;
  }

  return false;
}

// 5. FUNGSI MENGHAPUS FOLDER
export const deleteFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const folder = await prisma.folder.findUnique({
      where: { id },
      include: {
        sub_folders: true,
        documents: true,
      },
    });

    if (!folder) {
      res.status(404).json({ message: 'Folder tidak ditemukan.' });
      return;
    }

    if (!canModifyFolder(req.user!.role, req.user!.userId, folder.owner_id)) {
      res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus folder ini.' });
      return;
    }

    // Kebijakan: cegah penghapusan jika folder masih berisi dokumen.
    // (sub_folders akan otomatis terhapus karena onDelete: Cascade di schema,
    // tapi Document tidak memiliki cascade dari Folder, jadi wajib dicek manual)
    if (folder.documents.length > 0) {
      res.status(400).json({
        message: 'Folder tidak dapat dihapus karena masih berisi dokumen. Pindahkan atau hapus dokumen terlebih dahulu.',
      });
      return;
    }

    // letakkan setelah pengecekan folder.documents.length > 0, sebelum prisma.folder.delete
    await logActivity({
        userId: req.user!.userId,
        action: 'DELETE_FOLDER',
        details: `Menghapus folder "${folder.name}" (ID: ${id})`,
        ipAddress: getClientIp(req),
        });

    await prisma.folder.delete({ where: { id } });

    res.status(200).json({ message: 'Folder berhasil dihapus.' });
  } catch (error) {
    console.error('Delete Folder Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat menghapus folder.' });
  }
};