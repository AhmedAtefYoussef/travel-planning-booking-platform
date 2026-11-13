/** ACC-05 (workbook values): 5 consecutive failed logins lock the account for 15 minutes. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const LOCKOUT_MS = LOCKOUT_MINUTES * 60_000;
