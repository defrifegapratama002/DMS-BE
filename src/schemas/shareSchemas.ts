import { z } from 'zod';

export const shareDocumentSchema = z.object({
  user_id: z.string().uuid('user_id harus berupa UUID valid.'),
  access_level: z.enum(['VIEWER', 'DOWNLOADER', 'EDITOR']).optional(),
});

export const updateShareAccessSchema = z.object({
  access_level: z.enum(['VIEWER', 'DOWNLOADER', 'EDITOR'], {
    message: 'access_level tidak valid. Pilih salah satu: VIEWER, DOWNLOADER, EDITOR.',
  }),
});