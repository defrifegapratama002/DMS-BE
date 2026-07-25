import { z } from 'zod';

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Nama folder wajib diisi.').max(255, 'Nama folder maksimal 255 karakter.'),
  parent_folder_id: z.string().uuid('parent_folder_id harus berupa UUID valid.').optional().nullable(),
});

export const renameFolderSchema = z.object({
  name: z.string().trim().min(1, 'Nama folder baru wajib diisi.').max(255, 'Nama folder maksimal 255 karakter.'),
});

export const moveFolderSchema = z.object({
  new_parent_folder_id: z.string().uuid('new_parent_folder_id harus berupa UUID valid.').optional().nullable(),
});