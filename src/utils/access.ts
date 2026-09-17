import type { Prisma } from '@prisma/client';

/**
 * Aturan akses terpusat.
 * - SUPER_ADMIN / COMPANY_ADMIN : kelola semua folder & dokumen.
 * - AUDITOR                     : baca semua (read-only).
 * - EMPLOYEE                    : miliknya sendiri, yang dibagikan kepadanya, dan dokumen APPROVED.
 */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN'];

export const isAdmin = (role: string): boolean => ADMIN_ROLES.includes(role);

/** Boleh membaca seluruh data (admin + auditor). */
export const canReadAll = (role: string): boolean =>
  isAdmin(role) || role === 'AUDITOR';

interface Actor {
  id: string;
  role: string;
}

/** Filter Prisma: dokumen (non-sampah) yang boleh dilihat user. */
export function visibleDocumentsWhere(user: Actor): Prisma.DocumentWhereInput {
  if (canReadAll(user.role)) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { uploadedBy: user.id },
      { folder: { ownerId: user.id } },
      { shares: { some: { userId: user.id } } },
      { status: 'APPROVED' },
    ],
  };
}

/** Filter Prisma: folder yang boleh dilihat user. */
export function visibleFoldersWhere(user: Actor): Prisma.FolderWhereInput {
  return canReadAll(user.role) ? {} : { ownerId: user.id };
}

interface DocLike {
  uploadedBy: string;
  status: string;
  folder?: { ownerId: string } | null;
  shares?: { userId: string; accessLevel: string }[];
}

export function shareLevelFor(doc: DocLike, userId: string): string | null {
  return doc.shares?.find((s) => s.userId === userId)?.accessLevel ?? null;
}

export function isDocumentOwner(doc: DocLike, userId: string): boolean {
  return doc.uploadedBy === userId || doc.folder?.ownerId === userId;
}

export function canReadDocument(doc: DocLike, user: Actor): boolean {
  return (
    canReadAll(user.role) ||
    isDocumentOwner(doc, user.id) ||
    shareLevelFor(doc, user.id) !== null ||
    doc.status === 'APPROVED'
  );
}

/** Unduh berkas: VIEWER (share) hanya boleh melihat, tidak mengunduh. */
export function canDownloadDocument(doc: DocLike, user: Actor): boolean {
  if (canReadAll(user.role) || isDocumentOwner(doc, user.id)) return true;
  const level = shareLevelFor(doc, user.id);
  if (level) return level !== 'VIEWER';
  return doc.status === 'APPROVED';
}

export function canEditDocument(doc: DocLike, user: Actor): boolean {
  if (user.role === 'AUDITOR') return false;
  return (
    isAdmin(user.role) ||
    isDocumentOwner(doc, user.id) ||
    shareLevelFor(doc, user.id) === 'EDITOR'
  );
}
