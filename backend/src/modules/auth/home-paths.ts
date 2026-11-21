import { Role } from '../../common/auth/auth.types';

/**
 * ACC-04: each role lands on its own home page. The paths are the Milestone 2 frontend routes; the
 * frontend redirects to `homePath` after login.
 */
export const HOME_PATHS: Readonly<Record<Role, string>> = {
  [Role.User]: '/',
  [Role.Admin]: '/admin',
  [Role.AirlineModerator]: '/moderator/airline',
  [Role.HotelModerator]: '/moderator/hotel',
};

/** Where an account with a temporary password lands until it sets its own (ACC-07a, ACC-13). */
export const CHANGE_PASSWORD_PATH = '/account/change-password';
