import { z } from 'zod';

// Whitelist ekstensi — sesuai catatan keamanan di PRD (validasi tipe berkas di level middleware)
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'txt', 'csv'] as const;

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Judul dokumen wajib diisi.').max(255, 'Judul maksimal 255 karakter.'),
  extension: z.enum(ALLOWED_EXTENSIONS, {
    message: `Ekstensi berkas tidak didukung. Pilihan: ${ALLOWED_EXTENSIONS.join(', ')}.`,
  }),
  size_bytes: z
    .number()
    .positive('Ukuran berkas harus lebih dari 0.')
    .max(500 * 1024 * 1024, 'Ukuran berkas maksimal 500MB.'),
  folder_id: z.string().uuid('folder_id harus berupa UUID valid.'),
});

export const renameDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Judul dokumen baru wajib diisi.').max(255, 'Judul maksimal 255 karakter.'),
});

export const uploadVersionSchema = z.object({
  size_bytes: z
    .number()
    .positive('Ukuran berkas harus lebih dari 0.')
    .max(500 * 1024 * 1024, 'Ukuran berkas maksimal 500MB.'),
  changelog: z.string().trim().max(1000, 'Changelog maksimal 1000 karakter.').optional(),
  extension: z.enum(ALLOWED_EXTENSIONS).optional(),
});