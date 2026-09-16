import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import { AppError } from '../utils/errorGuards.js';

// ============ Validation Schemas ============
const tagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const documentTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

const correspondentSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const updateMetaSchema = z.object({
  tagIds: z.array(z.string().uuid()).optional(),
  documentTypeId: z.string().uuid().nullable().optional(),
  correspondentId: z.string().uuid().nullable().optional(),
  documentDate: z.string().datetime().nullable().optional(),
  asn: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

// =============================================
//                      TAG
// =============================================
export class TagController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tags = await prisma.tag.findMany({
        include: { _count: { select: { documents: true } } },
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data: tags });
    } catch (error) {
      console.error('List tags error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const validated = tagSchema.parse(req.body);

      const existing = await prisma.tag.findUnique({
        where: { name: validated.name },
      });
      if (existing) {
        res.status(409).json({ success: false, message: 'Tag already exists' });
        return;
      }

      const tag = await prisma.tag.create({
        data: {
          name: validated.name,
          color: validated.color || '#6B7280',
          createdBy: userId,
        },
      });

      await logActivityWithRequest(
        req,
        userId,
        'CREATE_META',
        { type: 'TAG', name: tag.name },
        'TAG',
        tag.id
      );

      res.status(201).json({ success: true, data: tag });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Create tag error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = tagSchema.partial().parse(req.body);

      const tag = await prisma.tag.update({ where: { id }, data: validated });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_META',
        { type: 'TAG', name: tag.name, changes: validated },
        'TAG',
        id
      );

      res.json({ success: true, data: tag });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Update tag error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      await prisma.tag.delete({ where: { id } });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'DELETE_META',
        { type: 'TAG', tagId: id },
        'TAG',
        id
      );

      res.json({ success: true, message: 'Tag deleted' });
    } catch (error) {
      console.error('Delete tag error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

// =============================================
//                 DOCUMENT TYPE
// =============================================
export class DocumentTypeController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const types = await prisma.documentType.findMany({
        include: { _count: { select: { documents: true } } },
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data: types });
    } catch (error) {
      console.error('List types error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const validated = documentTypeSchema.parse(req.body);

      const existing = await prisma.documentType.findUnique({
        where: { name: validated.name },
      });
      if (existing) {
        res.status(409).json({ success: false, message: 'Document type already exists' });
        return;
      }

      const type = await prisma.documentType.create({ data: validated });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'CREATE_META',
        { type: 'DOCUMENT_TYPE', name: type.name },
        'DOCUMENT_TYPE',
        type.id
      );

      res.status(201).json({ success: true, data: type });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Create type error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = documentTypeSchema.partial().parse(req.body);

      const type = await prisma.documentType.update({ where: { id }, data: validated });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_META',
        { type: 'DOCUMENT_TYPE', name: type.name, changes: validated },
        'DOCUMENT_TYPE',
        id
      );

      res.json({ success: true, data: type });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Update type error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      await prisma.documentType.delete({ where: { id } });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'DELETE_META',
        { type: 'DOCUMENT_TYPE', typeId: id },
        'DOCUMENT_TYPE',
        id
      );

      res.json({ success: true, message: 'Document type deleted' });
    } catch (error) {
      console.error('Delete type error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

// =============================================
//                CORRESPONDENT
// =============================================
export class CorrespondentController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const items = await prisma.correspondent.findMany({
        include: { _count: { select: { documents: true } } },
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data: items });
    } catch (error) {
      console.error('List correspondents error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const validated = correspondentSchema.parse(req.body);

      const existing = await prisma.correspondent.findUnique({
        where: { name: validated.name },
      });
      if (existing) {
        res.status(409).json({ success: false, message: 'Correspondent already exists' });
        return;
      }

      const item = await prisma.correspondent.create({ data: validated });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'CREATE_META',
        { type: 'CORRESPONDENT', name: item.name },
        'CORRESPONDENT',
        item.id
      );

      res.status(201).json({ success: true, data: item });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Create correspondent error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = correspondentSchema.partial().parse(req.body);

      const item = await prisma.correspondent.update({ where: { id }, data: validated });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_META',
        { type: 'CORRESPONDENT', name: item.name, changes: validated },
        'CORRESPONDENT',
        id
      );

      res.json({ success: true, data: item });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Update correspondent error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      await prisma.correspondent.delete({ where: { id } });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'DELETE_META',
        { type: 'CORRESPONDENT', correspondentId: id },
        'CORRESPONDENT',
        id
      );

      res.json({ success: true, message: 'Correspondent deleted' });
    } catch (error) {
      console.error('Delete correspondent error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

// =============================================
//            DOCUMENT METADATA
// =============================================
export class DocumentMetaController {
  static async updateMeta(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user!.id;
      const validated = updateMetaSchema.parse(req.body);

      // Cek akses
      const document = await prisma.document.findUnique({
        where: { id },
        include: { shares: { where: { userId, accessLevel: 'EDITOR' } } },
      });

      if (!document) {
        res.status(404).json({ success: false, message: 'Document not found' });
        return;
      }

      if (document.deletedAt) {
        res.status(400).json({ success: false, message: 'Cannot update trashed document' });
        return;
      }

      const hasEdit = document.uploadedBy === userId || document.shares.length > 0;
      if (!hasEdit) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      // Prepare update data
      const updateData: any = {};

      if (validated.description !== undefined) {
        updateData.description = validated.description;
      }
      if (validated.documentTypeId !== undefined) {
        updateData.documentTypeId = validated.documentTypeId;
      }
      if (validated.correspondentId !== undefined) {
        updateData.correspondentId = validated.correspondentId;
      }
      if (validated.documentDate !== undefined) {
        updateData.documentDate = validated.documentDate ? new Date(validated.documentDate) : null;
      }
      if (validated.asn !== undefined) {
        updateData.asn = validated.asn;
      }

      // Handle tags (delete + recreate)
      if (validated.tagIds !== undefined) {
        // Hapus tag lama
        await prisma.documentTag.deleteMany({ where: { documentId: id } });
        // Buat tag baru
        if (validated.tagIds.length > 0) {
          await prisma.documentTag.createMany({
            data: validated.tagIds.map((tagId) => ({
              documentId: id,
              tagId,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Update document
      const updated = await prisma.document.update({
        where: { id },
        data: updateData,
        include: {
          documentType: true,
          correspondent: true,
          documentTags: { include: { tag: true } },
        },
      });

      await logActivityWithRequest(
        req,
        userId,
        'UPDATE_DOCUMENT_META',
        { title: document.title, changes: validated },
        'DOCUMENT',
        id
      );

      res.json({
        success: true,
        message: 'Document metadata updated',
        data: updated,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
        return;
      }
      console.error('Update meta error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async bulkUpdateMeta(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { ids, tagIds, documentTypeId, correspondentId } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ success: false, message: 'ids array required' });
        return;
      }

      const results = [];

      for (const docId of ids) {
        const doc = await prisma.document.findUnique({ where: { id: docId } });
        if (!doc || doc.deletedAt || doc.uploadedBy !== userId) continue;

        const updateData: any = {};
        if (documentTypeId !== undefined) updateData.documentTypeId = documentTypeId;
        if (correspondentId !== undefined) updateData.correspondentId = correspondentId;

        await prisma.document.update({ where: { id: docId }, data: updateData });

        if (Array.isArray(tagIds)) {
          await prisma.documentTag.deleteMany({ where: { documentId: docId } });
          if (tagIds.length > 0) {
            await prisma.documentTag.createMany({
              data: tagIds.map((tagId: string) => ({ documentId: docId, tagId })),
              skipDuplicates: true,
            });
          }
        }

        results.push(docId);
      }

      await logActivityWithRequest(
        req,
        userId,
        'UPDATE_DOCUMENT_META',
        { count: results.length, mode: 'bulk' },
        'DOCUMENT'
      );

      res.json({
        success: true,
        message: `${results.length} documents updated`,
        data: { updated: results },
      });
    } catch (error) {
      console.error('Bulk update error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}