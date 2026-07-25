import type { Request } from 'express';
import { prisma } from '../config/prisma.js';

export type ActivityAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'CREATE_FOLDER'
  | 'RENAME_FOLDER'
  | 'MOVE_FOLDER'
  | 'DELETE_FOLDER'
  | 'CREATE_DOCUMENT'
  | 'RENAME_DOCUMENT'
  | 'UPLOAD_VERSION'
  | 'DELETE_DOCUMENT'
  | 'SHARE_DOCUMENT'
  | 'UPDATE_SHARE_ACCESS'
  | 'REVOKE_SHARE';

interface LogActivityParams {
  userId: string;
  action: ActivityAction;
  details: string;
  ipAddress: string;
}

export async function logActivity({ userId, action, details, ipAddress }: LogActivityParams): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        user_id: userId,
        action,
        details,
        ip_address: ipAddress,
      },
    });
  } catch (error) {
    console.error(`Gagal mencatat ActivityLog [${action}] untuk user ${userId}:`, error);
  }
}

// PERBAIKAN: parameter sekarang bertipe Request langsung dari Express,
// bukan tipe custom yang tidak identik strukturnya dengan Request asli.
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket.remoteAddress || 'unknown';
}