/** Client-safe public API of the auth feature (server helpers live in './server'). */
export {
  CHANGE_PASSWORD_PATH,
  HOME_PATH,
  PROTECTED_SECTIONS,
  canAccess,
  isProtectedPath,
  sectionFor,
} from './model/roles';
export { safeNextPath, withNext } from './model/next-path';
export { AuthProvider, useAuth } from './ui/auth-provider';
