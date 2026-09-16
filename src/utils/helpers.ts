import type { Response } from 'express';
import type { ApiResponse } from '../types/index.js';
import type { Request } from 'express';

export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200
): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };
  if (message) response.message = message;
  return res.status(statusCode).json(response);
}

export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
  error?: any
): Response {
  const response: ApiResponse = {
    success: false,
    message,
  };
  if (process.env.NODE_ENV === 'development' && error?.message) {
    response.error = error.message;
  }
  return res.status(statusCode).json(response);
}

export function generateRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getPaginationParams(query: any) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Get a single string param from Express request.
 * Express 5 types sometimes returns string | string[]
 */
export function getParam(req: Request, key: string): string {
  const value = req.params[key];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

/**
 * Parse and stringify details untuk ActivityLog
 */
export function detailsToString(details: Record<string, any> | string): string {
  return typeof details === 'string' ? details : JSON.stringify(details);
}