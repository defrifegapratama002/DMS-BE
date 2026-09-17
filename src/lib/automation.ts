import type { Request } from 'express';
import { prisma } from '../config/prisma.js';
import { logActivityWithRequest } from '../utils/activityLogger.js';
import type { DocumentStatus } from './workflow.js';

/**
 * Otomatisasi (workflow rules ala Paperless): saat unggah / status berubah,
 * aturan aktif yang cocok menempelkan tag, tipe dokumen, pihak, atau status.
 * Berbeda dari lib/workflow.ts yang mengatur transisi status manual.
 */
export type AutomationTrigger = 'upload' | 'status_change';

interface AutomationDoc {
  id: string;
  title: string;
  extension: string;
  folderId: string;
}

export async function runAutomation(
  req: Request,
  userId: string,
  trigger: AutomationTrigger,
  doc: AutomationDoc,
  ctx: { newStatus?: DocumentStatus } = {}
): Promise<string[]> {
  try {
    const rules = await prisma.workflowRule.findMany({
      where: { enabled: true, trigger },
      orderBy: { sortOrder: 'asc' },
    });

    const matched = rules.filter((r) => {
      if (trigger === 'status_change' && r.triggerStatus && r.triggerStatus !== ctx.newStatus)
        return false;
      if (r.matchFolderId && r.matchFolderId !== doc.folderId) return false;
      if (
        r.matchExtensions.length > 0 &&
        !r.matchExtensions.map((e) => e.toLowerCase()).includes(doc.extension.toLowerCase())
      )
        return false;
      const needle = r.matchTitleContains.trim().toLowerCase();
      if (needle && !doc.title.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (matched.length === 0) return [];

    const tagIds = new Set<string>();
    const data: {
      documentTypeId?: string;
      correspondentId?: string;
      status?: DocumentStatus;
    } = {};
    for (const r of matched) {
      r.assignTagIds.forEach((t) => tagIds.add(t));
      if (r.assignTypeId) data.documentTypeId = r.assignTypeId;
      if (r.assignCorrespondentId) data.correspondentId = r.assignCorrespondentId;
      if (trigger === 'upload' && r.assignStatus) data.status = r.assignStatus as DocumentStatus;
    }

    // Abaikan referensi yang sudah dihapus agar tidak melanggar FK.
    const [tags, type, correspondent] = await Promise.all([
      prisma.tag.findMany({ where: { id: { in: [...tagIds] } }, select: { id: true } }),
      data.documentTypeId
        ? prisma.documentType.findUnique({ where: { id: data.documentTypeId } })
        : null,
      data.correspondentId
        ? prisma.correspondent.findUnique({ where: { id: data.correspondentId } })
        : null,
    ]);
    if (!type) delete data.documentTypeId;
    if (!correspondent) delete data.correspondentId;

    if (tags.length > 0) {
      await prisma.documentTag.createMany({
        data: tags.map((t) => ({ documentId: doc.id, tagId: t.id })),
        skipDuplicates: true,
      });
    }
    if (Object.keys(data).length > 0) {
      await prisma.document.update({ where: { id: doc.id }, data });
    }

    await prisma.workflowRule.updateMany({
      where: { id: { in: matched.map((r) => r.id) } },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });

    const names = matched.map((r) => r.name);
    await logActivityWithRequest(
      req,
      userId,
      'WORKFLOW_APPLIED',
      { title: doc.title, trigger, rules: names },
      'DOCUMENT',
      doc.id
    );
    return names;
  } catch (error) {
    // Otomatisasi tidak boleh menggagalkan unggah / perubahan status.
    console.error('Automation error:', error);
    return [];
  }
}
