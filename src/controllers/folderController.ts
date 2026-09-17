import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import { isAdmin, visibleFoldersWhere } from '../utils/access.js';

/** Admin mengelola semua folder; selain itu hanya folder miliknya. */
const manageableFolder = (id: string, user: { id: string; role: string }) =>
  isAdmin(user.role) ? { id } : { id, ownerId: user.id };

const createFolderSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parentFolderId: z.string().uuid().optional(),
});

const updateFolderSchema = z.object({
  name: z.string().min(1).optional(),
});

const moveFolderSchema = z.object({
  parentFolderId: z.string().uuid().nullable(),
});

// GET tree
export const getFolderTree = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const folders = await prisma.folder.findMany({
      where: { ownerId: userId, parentFolderId: null },
      include: {
        subFolders: { include: { subFolders: true } },
        documents: { select: { id: true, title: true, extension: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: folders });
  } catch (error) {
    console.error('Get folder tree error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const getFolderContents = getFolderTree;

// GET /folders/all — daftar datar semua folder yang boleh dilihat user
// (tree di atas hanya 3 tingkat; FE menyusun hierarki penuh dari parentFolderId).
export const getAllFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const folders = await prisma.folder.findMany({
      where: visibleFoldersWhere(req.user!),
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { documents: { where: { deletedAt: null } }, subFolders: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: folders });
  } catch (error) {
    console.error('Get all folders error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// CREATE
export const createFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const validated = createFolderSchema.parse(req.body);

    if (validated.parentFolderId) {
      const parent = await prisma.folder.findFirst({
        where: manageableFolder(validated.parentFolderId, req.user!),
      });
      if (!parent) {
        res.status(404).json({ success: false, message: 'Parent folder not found' });
        return;
      }
    }

    const folder = await prisma.folder.create({
      data: {
        name: validated.name,
        description: validated.description || null,
        ownerId: userId,
        parentFolderId: validated.parentFolderId || null,
      },
    });

    await logActivityWithRequest(
      req,
      userId,
      'CREATE_FOLDER',
      { name: folder.name, parentId: folder.parentFolderId },
      'FOLDER',
      folder.id
    );

    res.status(201).json({ success: true, message: 'Folder created', data: folder });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Create folder error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// RENAME
export const renameFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;
    const validated = updateFolderSchema.parse(req.body);

    const folder = await prisma.folder.findFirst({ where: manageableFolder(id, req.user!) });
    if (!folder) {
      res.status(404).json({ success: false, message: 'Folder not found' });
      return;
    }

    const updated = await prisma.folder.update({ where: { id }, data: validated });

    await logActivityWithRequest(
      req,
      userId,
      'RENAME_FOLDER',
      { name: updated.name },
      'FOLDER',
      id
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Rename folder error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// MOVE
export const moveFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;
    const validated = moveFolderSchema.parse(req.body);

    const folder = await prisma.folder.findFirst({ where: manageableFolder(id, req.user!) });
    if (!folder) {
      res.status(404).json({ success: false, message: 'Folder not found' });
      return;
    }

    if (validated.parentFolderId === id) {
      res.status(400).json({ success: false, message: 'Cannot move folder to itself' });
      return;
    }

    // Cegah siklus: tujuan tidak boleh berada di bawah folder yang dipindah.
    let cursor = validated.parentFolderId;
    while (cursor) {
      if (cursor === id) {
        res.status(400).json({
          success: false,
          message: 'Tidak bisa memindahkan folder ke dalam sub-foldernya sendiri',
        });
        return;
      }
      const parent: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
        where: { id: cursor },
        select: { parentFolderId: true },
      });
      cursor = parent?.parentFolderId ?? null;
    }

    const updated = await prisma.folder.update({
      where: { id },
      data: { parentFolderId: validated.parentFolderId },
    });

    await logActivityWithRequest(
      req,
      userId,
      'MOVE_FOLDER',
      { folderId: id, newParentId: validated.parentFolderId },
      'FOLDER',
      id
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
      return;
    }
    console.error('Move folder error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// DELETE
export const deleteFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const folder = await prisma.folder.findFirst({
      where: manageableFolder(id, req.user!),
      include: { subFolders: true, documents: true },
    });

    if (!folder) {
      res.status(404).json({ success: false, message: 'Folder not found' });
      return;
    }

    // Sub-folder ikut terhapus (cascade), jadi dokumen di seluruh turunannya juga dicek.
    const subtree = [id];
    for (let i = 0; i < subtree.length; i++) {
      const children = await prisma.folder.findMany({
        where: { parentFolderId: subtree[i]! },
        select: { id: true },
      });
      subtree.push(...children.map((c) => c.id));
    }
    const [activeDocs, trashedDocs] = await Promise.all([
      prisma.document.count({ where: { folderId: { in: subtree }, deletedAt: null } }),
      prisma.document.count({ where: { folderId: { in: subtree }, deletedAt: { not: null } } }),
    ]);

    if (activeDocs > 0) {
      res.status(400).json({
        success: false,
        message: 'Folder (atau sub-foldernya) masih berisi dokumen. Pindahkan atau hapus dokumennya dulu.',
      });
      return;
    }

    if (trashedDocs > 0) {
      res.status(400).json({
        success: false,
        message: 'Folder masih punya dokumen di Sampah. Hapus permanen atau pulihkan dulu.',
      });
      return;
    }

    await prisma.folder.delete({ where: { id } });

    await logActivityWithRequest(
      req,
      userId,
      'DELETE_FOLDER',
      {
        name: folder.name,
        subFoldersCount: folder.subFolders.length,
        documentsCount: folder.documents.length,
      },
      'FOLDER',
      id
    );

    res.json({ success: true, message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};