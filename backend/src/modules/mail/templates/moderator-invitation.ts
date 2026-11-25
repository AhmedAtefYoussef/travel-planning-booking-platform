import { absoluteUrl, renderEmail, type RenderedEmail } from './layout';

export interface ModeratorInvitationInput {
  name: string;
  baseUrl: string;
}

/**
 * ACC-13. Deliberately takes no password: email is not a safe place for a credential, so the invitation
 * only says an account exists and that an administrator will hand over the temporary password.
 */
export function moderatorInvitation(
  input: ModeratorInvitationInput,
): RenderedEmail {
  const loginUrl = absoluteUrl(input.baseUrl, '/login');
  return renderEmail({
    subject: 'You have been invited as a moderator',
    heading: `Welcome, ${input.name}`,
    paragraphs: [
      'An administrator has created a moderator account for you on Travel Platform.',
      'An administrator will share your temporary password with you separately. Use it to sign in, then choose a new password when asked.',
    ],
    action: { label: 'Sign in', url: loginUrl },
  });
}
