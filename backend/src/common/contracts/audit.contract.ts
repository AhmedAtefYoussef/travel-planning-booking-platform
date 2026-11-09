/** Contract 8 - audit (Ahmed -> everyone). Interface only. */

export interface AuditEntry {
  /** null for system actions (jobs, webhooks). */
  actorId: string | null;
  /** e.g. PAYMENT_SUCCEEDED, USER_SUSPENDED */
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditService {
  record(entry: AuditEntry): Promise<void>;
}
