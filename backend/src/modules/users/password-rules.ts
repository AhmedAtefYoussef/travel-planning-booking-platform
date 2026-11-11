/**
 * Password rules (ACC-01, ACC-08, ACC-07a): at least 8 characters with at least one letter and one
 * digit. The 72-byte upper bound is bcrypt's limit (common/security/password.service.ts).
 * Shared by the registration and change-password DTOs and the admin seed.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_RULE_MESSAGE =
  'password must be at least 8 characters and contain at least one letter and one digit';

export function meetsPasswordRules(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN_LENGTH &&
    PASSWORD_PATTERN.test(password)
  );
}
