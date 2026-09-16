import type { Request } from 'express';

// ============ JWT ============
export interface JwtPayload {
  userId: string;
  type: 'access' | 'refresh';
}

// ============ Auth Request ============
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    companyId?: string | null;
  };
}

// ============ Pagination ============
export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============ API Response ============
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

// ============ Activity Actions ============
export type ActivityAction =
  // Auth
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REGISTER'
  | 'REGISTER_FAILED'
  | 'REFRESH_TOKEN'
  | 'REFRESH_TOKEN_FAILED'
  // Folders
  | 'CREATE_FOLDER'
  | 'RENAME_FOLDER'
  | 'MOVE_FOLDER'
  | 'DELETE_FOLDER'
  | 'VIEW_FOLDER'
  // Documents
  | 'CREATE_DOCUMENT'
  | 'RENAME_DOCUMENT'
  | 'UPLOAD_VERSION'
  | 'DELETE_DOCUMENT'
  | 'DOWNLOAD_DOCUMENT'
  | 'VIEW_DOCUMENT'
  | 'UPDATE_DOCUMENT'
  | 'RESTORE_DOCUMENT'
  | 'MOVE_DOCUMENT'
  // Workflow status
  | 'SUBMIT_REVIEW'
  | 'WITHDRAW_REVIEW'
  | 'APPROVE'          
  | 'REJECT'           
  | 'ARCHIVE'
  | 'UNARCHIVE'
  // Legacy alias (untuk kompatibilitas)
  | 'APPROVE_DOCUMENT'
  | 'REJECT_DOCUMENT'
  | 'ARCHIVE_DOCUMENT'
  // Shares
  | 'SHARE_DOCUMENT'
  | 'UPDATE_SHARE_ACCESS'
  | 'REVOKE_SHARE'
  | 'CREATE_SHARE_LINK'
  | 'REVOKE_SHARE_LINK'
  | 'ACCESS_SHARE_LINK'
  // Users
  | 'UPDATE_USER'
  | 'DELETE_USER'
  | 'CHANGE_ROLE'
  | 'RESET_PASSWORD'
  // Notes
  | 'ADD_NOTE'
  | 'DELETE_NOTE'
  // Metadata
  | 'UPDATE_DOCUMENT_META'
  | 'CREATE_META'
  | 'UPDATE_META'
  | 'DELETE_META'
  // Workflows (otomatisasi)
  | 'WORKFLOW_APPLIED'
  | 'UPDATE_WORKFLOW'
  // System
  | 'SYSTEM_ERROR'
  | 'CRON_JOB';

// ============ Entity Types ============
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