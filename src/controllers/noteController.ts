import type { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import { canReadDocument, isAdmin } from '../utils/access.js';

const noteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

const USER_SELECT = { id: true, name: true, email: true, role: true } as const;

async function findReadableDocument(id: string, user: { id: string; role: string }) {
  const document = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    include: {
      folder: { select: { ownerId: true } },
      shares: { select: { userId: true, accessLevel: true } },
    },
  });
  return document && canReadDocument(document, user) ? document : null;
}

export class NoteController {
  // GET /documents/:id/notes
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const document = await findReadableDocument(req.params.id as string, req.user!);
      if (!document) {
        res.status(404).json({ success: false, message: 'Not found or access denied' });
        return;
      }

      const notes = await prisma.documentNote.findMany({
        where: { documentId: document.id },
        include: { user: { select: USER_SELECT } },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: notes });
    } catch (error) {
      console.error('List notes error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // POST /documents/:id/notes
  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const { body } = noteSchema.parse(req.body);

      const document = await findReadableDocument(req.params.id as string, user);
      if (!document) {
        res.status(404).json({ success: false, message: 'Not found or access denied' });
        return;
      }

      const note = await prisma.documentNote.create({
        data: { documentId: document.id, userId: user.id, body },
        include: { user: { select: USER_SELECT } },
      });

      await logActivityWithRequest(
        req,
        user.id,
        'ADD_NOTE',
        { title: document.title },
        'DOCUMENT',
        document.id
      );

      res.status(201).json({ success: true, data: note });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Catatan tidak boleh kosong.', errors: error.issues });
        return;
      }
      console.error('Create note error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // DELETE /documents/notes/:noteId — penulis catatan atau admin
  static async remove(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const note = await prisma.documentNote.findUnique({
        where: { id: req.params.noteId as string },
        include: { document: { select: { id: true, title: true } } },
      });

      if (!note) {
        res.status(404).json({ success: false, message: 'Note not found' });
        return;
      }

      if (note.userId !== user.id && !isAdmin(user.role)) {
        res.status(403).json({ success: false, message: 'Hanya penulis atau admin yang bisa menghapus catatan.' });
        return;
      }

      await prisma.documentNote.delete({ where: { id: note.id } });

      await logActivityWithRequest(
        req,
        user.id,
        'DELETE_NOTE',
        { title: note.document.title },
        'DOCUMENT',
        note.document.id
      );

      res.json({ success: true, message: 'Note deleted' });
    } catch (error) {
      console.error('Delete note error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
