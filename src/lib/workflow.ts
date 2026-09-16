export type DocumentStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'ARCHIVED';

export type WorkflowAction =
  | 'SUBMIT_REVIEW'
  | 'WITHDRAW_REVIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'ARCHIVE'
  | 'UNARCHIVE';

interface TransitionRule {
  from: DocumentStatus;
  to: DocumentStatus;
  allowedRoles: string[];
  requireOwner?: boolean;
  requiresReason?: boolean;
}

export const WORKFLOW_TRANSITIONS: Record<WorkflowAction, TransitionRule> = {
  SUBMIT_REVIEW: {
    from: 'DRAFT',
    to: 'PENDING_REVIEW',
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'],
  },
  WITHDRAW_REVIEW: {
    from: 'PENDING_REVIEW',
    to: 'DRAFT',
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'],
    requireOwner: true,
  },
  APPROVE: {
    from: 'PENDING_REVIEW',
    to: 'APPROVED',
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  },
  REJECT: {
    from: 'PENDING_REVIEW',
    to: 'DRAFT',
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
    requiresReason: true,
  },
  ARCHIVE: {
    from: 'APPROVED',
    to: 'ARCHIVED',
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  },
  UNARCHIVE: {
    from: 'ARCHIVED',
    to: 'APPROVED',
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  },
};

export function getActionForTransition(
  from: DocumentStatus,
  to: DocumentStatus,
  context?: {
    userId?: string;
    userRole?: string;
    documentOwnerId?: string;
    hasReason?: boolean;
  }
): WorkflowAction | null {
  // Special case: PENDING_REVIEW → DRAFT punya 2 action (WITHDRAW vs REJECT)
  if (from === 'PENDING_REVIEW' && to === 'DRAFT' && context) {
    const isOwner = context.userId === context.documentOwnerId;
    const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(
      context.userRole || ''
    );

    // Admin + ada reason → REJECT
    if (isAdmin && context.hasReason) return 'REJECT';

    // Owner → WITHDRAW (menarik pengajuan sendiri)
    if (isOwner) return 'WITHDRAW_REVIEW';

    // Admin tanpa reason → REJECT (akan gagal karena requiresReason)
    if (isAdmin) return 'REJECT';

    return null;
  }

  // Default: match rule pertama
  for (const [action, rule] of Object.entries(WORKFLOW_TRANSITIONS)) {
    if (rule.from === from && rule.to === to) {
      return action as WorkflowAction;
    }
  }
  return null;
}

export function validateTransition(params: {
  action: WorkflowAction;
  currentStatus: DocumentStatus;
  userRole: string;
  userId: string;
  documentOwnerId: string;
  reason?: string;
}): { valid: boolean; error?: string } {
  const rule = WORKFLOW_TRANSITIONS[params.action];

  if (!rule) {
    return { valid: false, error: `Unknown action: ${params.action}` };
  }

  if (params.currentStatus !== rule.from) {
    return {
      valid: false,
      error: `Tidak bisa ${params.action} dari status ${params.currentStatus}. Status harus ${rule.from}.`,
    };
  }

  if (!rule.allowedRoles.includes(params.userRole)) {
    return {
      valid: false,
      error: `Role ${params.userRole} tidak diizinkan untuk ${params.action}`,
    };
  }

  if (rule.requireOwner && params.userId !== params.documentOwnerId) {
    return {
      valid: false,
      error: 'Hanya owner dokumen yang bisa melakukan aksi ini',
    };
  }

  if (
    rule.requiresReason &&
    (!params.reason || params.reason.trim().length === 0)
  ) {
    return { valid: false, error: 'Alasan wajib diisi untuk reject' };
  }

  return { valid: true };
}