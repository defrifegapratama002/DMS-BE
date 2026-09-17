import type { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import type { AuthRequest } from '../types/index.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';

const STATUS = z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED']);

// Body memakai snake_case mengikuti kontrak FE (sama seperti /shares).
const ruleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  trigger: z.enum(['upload', 'status_change']),
  trigger_status: STATUS.nullable().default(null),
  match_folder_id: z.string().uuid().nullable().default(null),
  match_extensions: z.array(z.string()).default([]),
  match_title_contains: z.string().default(''),
  assign_tag_ids: z.array(z.string().uuid()).default([]),
  assign_type_id: z.string().uuid().nullable().default(null),
  assign_correspondent_id: z.string().uuid().nullable().default(null),
  assign_status: STATUS.nullable().default(null),
});

const patchSchema = ruleSchema.partial();

type RuleInput = z.infer<typeof patchSchema>;

function toData(input: RuleInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.trigger !== undefined) data.trigger = input.trigger;
  if (input.trigger_status !== undefined) data.triggerStatus = input.trigger_status;
  if (input.match_folder_id !== undefined) data.matchFolderId = input.match_folder_id;
  if (input.match_extensions !== undefined)
    data.matchExtensions = input.match_extensions.map((e) => e.toLowerCase());
  if (input.match_title_contains !== undefined)
    data.matchTitleContains = input.match_title_contains;
  if (input.assign_tag_ids !== undefined) data.assignTagIds = input.assign_tag_ids;
  if (input.assign_type_id !== undefined) data.assignTypeId = input.assign_type_id;
  if (input.assign_correspondent_id !== undefined)
    data.assignCorrespondentId = input.assign_correspondent_id;
  if (input.assign_status !== undefined) data.assignStatus = input.assign_status;
  return data;
}

function zodFail(res: Response, error: z.ZodError): void {
  res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
}

export class WorkflowRuleController {
  static async list(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const rules = await prisma.workflowRule.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      res.json({ success: true, data: rules });
    } catch (error) {
      console.error('List workflow rules error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const validated = ruleSchema.parse(req.body);
      const last = await prisma.workflowRule.aggregate({ _max: { sortOrder: true } });

      const rule = await prisma.workflowRule.create({
        data: {
          ...(toData(validated) as { name: string; trigger: string }),
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_WORKFLOW',
        { mode: 'create', name: rule.name },
        'WORKFLOW',
        rule.id
      );

      res.status(201).json({ success: true, data: rule });
    } catch (error) {
      if (error instanceof z.ZodError) return zodFail(res, error);
      console.error('Create workflow rule error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const validated = patchSchema.parse(req.body);

      const existing = await prisma.workflowRule.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ success: false, message: 'Rule not found' });
        return;
      }

      const rule = await prisma.workflowRule.update({
        where: { id },
        data: toData(validated),
      });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_WORKFLOW',
        { mode: 'update', name: rule.name, changes: validated },
        'WORKFLOW',
        rule.id
      );

      res.json({ success: true, data: rule });
    } catch (error) {
      if (error instanceof z.ZodError) return zodFail(res, error);
      console.error('Update workflow rule error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async remove(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const existing = await prisma.workflowRule.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ success: false, message: 'Rule not found' });
        return;
      }

      await prisma.workflowRule.delete({ where: { id } });

      await logActivityWithRequest(
        req,
        req.user!.id,
        'UPDATE_WORKFLOW',
        { mode: 'delete', name: existing.name },
        'WORKFLOW',
        id
      );

      res.json({ success: true, message: 'Rule deleted' });
    } catch (error) {
      console.error('Delete workflow rule error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // POST /workflows/:id/move { direction: "up" | "down" } — tukar urutan dengan tetangga
  static async move(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const direction = req.body?.direction;
      if (direction !== 'up' && direction !== 'down') {
        res.status(400).json({ success: false, message: 'direction harus "up" atau "down"' });
        return;
      }

      const rules = await prisma.workflowRule.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const index = rules.findIndex((r) => r.id === id);
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      if (index < 0) {
        res.status(404).json({ success: false, message: 'Rule not found' });
        return;
      }

      if (swapWith >= 0 && swapWith < rules.length) {
        const ordered = [...rules];
        [ordered[index], ordered[swapWith]] = [ordered[swapWith]!, ordered[index]!];
        await prisma.$transaction(
          ordered.map((r, i) =>
            prisma.workflowRule.update({ where: { id: r.id }, data: { sortOrder: i } })
          )
        );
      }

      res.json({ success: true, message: 'Rule moved' });
    } catch (error) {
      console.error('Move workflow rule error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
