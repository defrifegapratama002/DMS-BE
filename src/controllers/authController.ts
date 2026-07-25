import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { logActivity, getClientIp } from '../utils/activityLogger.js';
import { isPrismaKnownError } from '../utils/errorGuards.js';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET dan JWT_REFRESH_SECRET wajib di-set di environment variables.');
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

// Helper: hash refresh token sebelum disimpan ke database (jangan pernah simpan token mentah)
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Helper: generate pasangan access token + refresh token, dan simpan refresh token (hashed) ke DB
async function issueTokenPair(userId: string, role: string) {
  const accessToken = jwt.sign({ userId, role }, JWT_ACCESS_SECRET as string, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  // userId disertakan juga di payload refresh token supaya bisa dipakai
  // saat logout (mencatat siapa yang logout) tanpa perlu query tambahan.
  const refreshTokenJwt = jwt.sign(
    { userId, jti: rawRefreshToken },
    JWT_REFRESH_SECRET as string,
    { expiresIn: '7d' }
  );

  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token_hash: hashToken(rawRefreshToken),
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken, refreshToken: refreshTokenJwt };
}

// 1. FUNGSI REGISTER USER
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body; // sudah tervalidasi & ter-trim oleh middleware

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        password_hash: passwordHash,  
        role: 'EMPLOYEE',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        created_at: true,
      },
    });

    res.status(201).json({
      message: 'Registrasi akun berhasil dilakukan.',
      user: newUser,
    });
    } catch (error) {
    if (isPrismaKnownError(error) && error.code === 'P2002') {
      res.status(409).json({ message: 'Email tersebut sudah terdaftar di sistem.' });
      return;
    }
    console.error('Register Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat melakukan registrasi.' });
  }
};

// 2. FUNGSI LOGIN USER
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Email dan password wajib diisi.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ message: 'Kombinasi email atau password salah.' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    // PERBAIKAN: logActivity dan res.status sekarang benar-benar berada
    // di dalam satu blok yang sama, hanya jalan kalau password memang salah.
    if (!isPasswordValid) {
      await logActivity({
        userId: user.id,
        action: 'LOGIN_FAILED',
        details: `Percobaan login gagal untuk email ${email}`,
        ipAddress: getClientIp(req),
      });
      res.status(401).json({ message: 'Kombinasi email atau password salah.' });
      return;
    }

    const { accessToken, refreshToken } = await issueTokenPair(user.id, user.role);

    await logActivity({
      userId: user.id,
      action: 'LOGIN',
      details: `Login berhasil dari email ${email}`,
      ipAddress: getClientIp(req),
    });

    res.status(200).json({
      message: 'Autentikasi login berhasil.',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat melakukan proses login.' });
  }
};

// 3. FUNGSI REFRESH TOKEN (ROTATION)
export const refreshAccessToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(401).json({ message: 'Refresh token tidak ditemukan.' });
      return;
    }

    let payload: { userId: string; jti: string };
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET as string) as unknown as {
        userId: string;
        jti: string;
      };
    } catch {
      res.status(401).json({ message: 'Refresh token tidak valid atau kedaluwarsa.' });
      return;
    }

    const tokenHash = hashToken(payload.jti);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!storedToken) {
      res.status(401).json({ message: 'Refresh token tidak dikenali.' });
      return;
    }

    // Reuse detection: token yang sudah di-revoke tapi dipakai lagi = indikasi pencurian.
    // Cabut seluruh refresh token milik user ini sebagai tindakan pengamanan.
    if (storedToken.revoked_at) {
      await prisma.refreshToken.updateMany({
        where: { user_id: storedToken.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      res.status(401).json({
        message: 'Terdeteksi penggunaan token yang tidak sah. Silakan login kembali.',
      });
      return;
    }

    if (storedToken.expires_at < new Date()) {
      res.status(401).json({ message: 'Refresh token telah kedaluwarsa. Silakan login kembali.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: storedToken.user_id } });
    if (!user) {
      res.status(401).json({ message: 'Pengguna tidak ditemukan.' });
      return;
    }

    // Cabut token lama, terbitkan pasangan token baru (rotation)
    const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(user.id, user.role);

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked_at: new Date() },
    });

    res.status(200).json({
      message: 'Token berhasil diperbarui.',
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat memperbarui token.' });
  }
};

// 4. FUNGSI LOGOUT (REVOKE REFRESH TOKEN)
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ message: 'Refresh token wajib disertakan untuk logout.' });
      return;
    }

    let payload: { userId: string; jti: string };
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET as string) as unknown as {
        userId: string;
        jti: string;
      };
    } catch {
      // Token sudah tidak valid pun tetap dianggap "berhasil logout" dari sisi klien
      res.status(200).json({ message: 'Logout berhasil.' });
      return;
    }

    const tokenHash = hashToken(payload.jti);
    await prisma.refreshToken.updateMany({
      where: { token_hash: tokenHash, revoked_at: null },
      data: { revoked_at: new Date() },
    });

    await logActivity({
      userId: payload.userId,
      action: 'LOGOUT',
      details: 'User logout dan mencabut refresh token.',
      ipAddress: getClientIp(req),
    });

    res.status(200).json({ message: 'Logout berhasil.' });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ message: 'Terjadi kegagalan server saat logout.' });
  }
};