import type { Response } from 'express';
import { prisma } from '../config/prisma.js';
import type { AuthRequest } from '../types/index.js';
import { visibleDocumentsWhere, visibleFoldersWhere } from '../utils/access.js';
import { snippetAround } from '../utils/fileInfo.js';

/** Skor sederhana: sama persis > awalan kata > mengandung. */
function score(text: string | null | undefined, q: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  if (!t.includes(q)) return 0;
  if (t === q) return 3;
  if (t.startsWith(q) || t.includes(` ${q}`)) return 2;
  return 1;
}

// GET /search?q=&limit=
// Mencari nama folder + dokumen (judul, deskripsi, ekstensi, ASN, tag, tipe, pihak, isi berkas teks).
export const searchAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const raw = String(req.query.q ?? '').trim();
    const q = raw.toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));

    if (!q) {
      res.json({ success: true, data: [] });
      return;
    }

    const contains = { contains: raw, mode: 'insensitive' as const };

    const [folders, documents] = await Promise.all([
      prisma.folder.findMany({
        where: { AND: [visibleFoldersWhere(user), { name: contains }] },
        include: { parentFolder: { select: { name: true } } },
        take: limit,
      }),
      prisma.document.findMany({
        where: {
          AND: [
            visibleDocumentsWhere(user),
            {
              OR: [
                { title: contains },
                { description: contains },
                { extension: contains },
                { asn: contains },
                { contentText: contains },
                { documentTags: { some: { tag: { name: contains } } } },
                { documentType: { name: contains } },
                { correspondent: { name: contains } },
              ],
            },
          ],
        },
        include: {
          folder: { select: { name: true } },
          documentTags: { include: { tag: true } },
          documentType: true,
          correspondent: true,
        },
        take: limit * 3,
      }),
    ]);

    const scored: Array<{ s: number; r: Record<string, unknown> }> = [];

    for (const f of folders) {
      scored.push({
        s: score(f.name, q),
        r: {
          kind: 'folder',
          id: f.id,
          name: f.name,
          path: f.parentFolder?.name ?? 'Root',
        },
      });
    }

    for (const d of documents) {
      const snippet = d.contentText ? snippetAround(d.contentText, raw) : undefined;
      const s = Math.max(
        score(d.title, q),
        score(d.extension, q) * 0.5,
        score(d.description, q) * 0.6,
        Math.max(0, ...d.documentTags.map((t) => score(t.tag.name, q))) * 0.8,
        score(d.documentType?.name, q) * 0.7,
        score(d.correspondent?.name, q) * 0.7,
        d.asn && d.asn.toLowerCase() === q ? 3 : 0,
        snippet ? 1 : 0
      );
      scored.push({
        s,
        r: {
          kind: 'document',
          id: d.id,
          title: d.title,
          extension: d.extension,
          status: d.status,
          folderName: d.folder.name,
          updatedAt: d.updatedAt,
          snippet,
        },
      });
    }

    scored.sort((a, b) => b.s - a.s);
    res.json({ success: true, data: scored.slice(0, limit).map((x) => x.r) });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
