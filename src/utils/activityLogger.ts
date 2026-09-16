import type { Request } from 'express';
import { prisma } from '../config/prisma.js';
import logger from './logger.js';
import type { ActivityAction, EntityType } from '../types/index.js';

export interface ActivityLogData {
  userId: string;
  action: ActivityAction;
  entityType?: EntityType;
  entityId?: string;
  documentId?: string;
  details: Record<string, any> | string;
  ipAddress: string;
  userAgent?: string;
  timestamp?: Date;
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string') {
    return cfConnectingIp;
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }

  return req.socket?.remoteAddress || 'unknown';
}

export function getUserAgent(req: Request): string | undefined {
  return req.headers['user-agent'];
}

export async function logActivity(data: ActivityLogData): Promise<void> {
  try {
    const detailsJson =
      typeof data.details === 'string'
        ? data.details
        : JSON.stringify(data.details);

    await prisma.activityLog.create({
      data: {
        userId: data.userId,           // ✅ camelCase
        action: data.action,
        entityType: data.entityType || null,
        entityId: data.entityId || null,
        documentId: data.documentId || null,
        details: detailsJson,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent || null,
        createdAt: data.timestamp || new Date(),
      },
    });
  } catch (error) {
    logger.error(
      `Failed to log activity [${data.action}] for user ${data.userId}:`,
      error
    );
  }
}

export async function logActivityWithRequest(
  req: Request,
  userId: string,
  action: ActivityAction,
  details: Record<string, any> | string,
  entityType?: EntityType,
  entityId?: string,
  documentId?: string
): Promise<void> {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  await logActivity({
    userId,
    action,
    entityType,
    entityId,
    documentId,
    details,
    ipAddress,
    userAgent,
  });
}