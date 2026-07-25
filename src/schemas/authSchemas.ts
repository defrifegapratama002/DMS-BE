import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(100, 'Nama maksimal 100 karakter.'),
  email: z.string().trim().toLowerCase().email('Format email tidak valid.'),
  password: z
    .string()
    .min(8, 'Password minimal 8 karakter.')
    .max(72, 'Password maksimal 72 karakter.'), // bcrypt punya batas efektif 72 byte
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Format email tidak valid.'),
  password: z.string().min(1, 'Password wajib diisi.'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token wajib diisi.'),
});