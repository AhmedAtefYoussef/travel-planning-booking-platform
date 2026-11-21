import { NewPasswordRules } from './new-password.rules';

/**
 * ACC-07a: the temporary password an admin gives the account. It meets the same rules as any password
 * (ACC-01) and is never echoed back; the account must replace it at its next login.
 */
export class ResetPasswordDto {
  @NewPasswordRules('Temp2026x')
  temporaryPassword!: string;
}
