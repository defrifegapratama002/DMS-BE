import type { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';

const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select', 'money', 'url'] as const;

const fieldSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1)).optional(),
});

function zodFail(res: Response, error: z.ZodError): void {
  res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
}

/** Jumlah dokumen aktif yang mengisi tiap bidang (nilai tidak null). */
async function usageCounts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ key: string; count: bigint }>>`
    SELECT kv.key AS key, COUNT(*) AS count
    FROM documents d, jsonb_each(COALESCE(d.custom_fields, '{}'::jsonb)) AS kv
    WHERE d.deleted_at IS NULL AND kv.value <> 'null'::jsonb AND kv.value <> '""'::jsonb
    GROUP BY kv.key
  `;
  return new Map(rows.map((r) => [r.key, Number(r.count)]));
}

export class CustomFieldController {
  static async list(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const [fields, counts] = await Promise.all([
        prisma.customField.findMany({ orderBy: { createdAt: 'asc' } }),
        usageCounts(),
      ]);
      res.json({
        success: true,
        data: fields.map((f) => ({ ...f, documentCount: counts.get(f.id) ?? 0 })),
      });
    } catch (error) {
      console.error('List custom fields error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const validated = fieldSchema.parse(req.body);

      const existing = await prisma.customField.findUnique({ where: { name: validated.name } });
      if (existing) {
        res.status(409).json({ success: false, message: 'Bidang dengan nama itu sudah ada.' });
        return;
      }

      const field = await prisma.customField.create({
        data: {
          name: validated.name,
          type: validated.type,
          options: validated.type === 'select' ? (validated.options ?? []) : [],
        },
      });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'CREATE_META',
        { type: 'CUSTOM_FIELD', name: field.name },
        'SYSTEM',
        field.id
      );

      res.status(201).json({ success: true, data: { ...field, documentCount: 0 } });
    } catch (error) {
      if (error instanceof z.ZodError) return zodFail(res, error);
      console.error('Create custom field error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = fieldSchema.partial().parse(req.body);

      const existing = await prisma.customField.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ success: false, message: 'Custom field not found' });
        return;
      }

      if (validated.name && validated.name !== existing.name) {
        const clash = await prisma.customField.findUnique({ where: { name: validated.name } });
        if (clash) {
          res.status(409).json({ success: false, message: 'Bidang dengan nama itu sudah ada.' });
          return;
        }
      }

      const type = validated.type ?? existing.type;
      const field = await prisma.customField.update({
        where: { id },
        data: {
          ...(validated.name !== undefined ? { name: validated.name } : {}),
          ...(validated.type !== undefined ? { type: validated.type } : {}),
          options: type === 'select' ? (validated.options ?? existing.options) : [],
        },
      });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_META',
        { type: 'CUSTOM_FIELD', name: field.name, changes: validated },
        'SYSTEM',
        field.id
      );

      const counts = await usageCounts();
      res.json({ success: true, data: { ...field, documentCount: counts.get(id) ?? 0 } });
    } catch (error) {
      if (error instanceof z.ZodError) return zodFail(res, error);
      console.error('Update custom field error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Menghapus definisi + nilainya di semua dokumen.
  static async remove(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const existing = await prisma.customField.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ success: false, message: 'Custom field not found' });
        return;
      }

      await prisma.$transaction([
        prisma.$executeRaw`
          UPDATE documents SET custom_fields = custom_fields - ${id}
          WHERE custom_fields ? ${id}
        `,
        prisma.customField.delete({ where: { id } }),
      ]);

      await logActivityWithRequest(
        req,
        req.user!.id,
        'DELETE_META',
        { type: 'CUSTOM_FIELD', name: existing.name },
        'SYSTEM',
        id
      );

      res.json({ success: true, message: 'Custom field deleted' });
    } catch (error) {
      console.error('Delete custom field error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
