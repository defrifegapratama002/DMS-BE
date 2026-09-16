import type { Request } from 'express';

export interface JwtPayload {
  userId: string;
  type: 'access' | 'refresh';
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    companyId?: string | null;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type ActivityAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REGISTER'
  | 'REGISTER_FAILED'
  | 'REFRESH_TOKEN'
  | 'REFRESH_TOKEN_FAILED'
  | 'CREATE_FOLDER'
  | 'RENAME_FOLDER'
  | 'MOVE_FOLDER'
  | 'DELETE_FOLDER'
  | 'VIEW_FOLDER'
  | 'CREATE_DOCUMENT'
  | 'RENAME_DOCUMENT'
  | 'UPLOAD_VERSION'
  | 'DELETE_DOCUMENT'
  | 'DOWNLOAD_DOCUMENT'
  | 'VIEW_DOCUMENT'
  | 'UPDATE_DOCUMENT'
  | 'ARCHIVE_DOCUMENT'
  | 'RESTORE_DOCUMENT'
  | 'MOVE_DOCUMENT'
  | 'SHARE_DOCUMENT'
  | 'UPDATE_SHARE_ACCESS'
  | 'REVOKE_SHARE'
  | 'CREATE_SHARE_LINK'
  | 'REVOKE_SHARE_LINK'
  | 'ACCESS_SHARE_LINK'
  | 'UPDATE_USER'
  | 'DELETE_USER'
  | 'CHANGE_ROLE'
  | 'RESET_PASSWORD'
  | 'ADD_NOTE'
  | 'DELETE_NOTE'
  | 'UPDATE_DOCUMENT_META'
  | 'CREATE_META'
  | 'UPDATE_META'
  | 'DELETE_META'
  | 'SUBMIT_REVIEW'
  | 'WITHDRAW_REVIEW'
  | 'APPROVE_DOCUMENT'
  | 'REJECT_DOCUMENT'
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'WORKFLOW_APPLIED'
  | 'UPDATE_WORKFLOW'
  | 'SYSTEM_ERROR'
  | 'CRON_JOB';

export type EntityType =
  | 'USER'
  | 'FOLDER'
  | 'DOCUMENT'
  | 'SHARE'
  | 'TAG'
  | 'DOCUMENT_TYPE'
  | 'CORRESPONDENT'
  | 'NOTE'
  | 'SHARE_LINK'
  | 'WORKFLOW'
  | 'SYSTEM';