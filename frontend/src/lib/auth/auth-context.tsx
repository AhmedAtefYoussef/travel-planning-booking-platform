'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/lib/api/client';
import type { UserProfile } from '@/lib/api/types';

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: UserProfile | null;
  status: AuthStatus;
  /** Re-reads the current user from GET /api/auth/me (e.g. after a profile update). */
  reload: () => Promise<UserProfile | null>;
  /** Call after a successful POST /api/auth/login with the response's `user`. */
  signedIn: (user: UserProfile) => void;
  /** POST /api/auth/logout (clears the cookies on the server), then back to the home page. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** GET /api/auth/me; 'silent' because a guest is a normal answer here, not a reason to redirect. */
function fetchCurrentUser(): Promise<UserProfile | null> {
  return api.get<UserProfile>('/auth/me', { auth: 'silent' }).catch(() => null);
}

/**
 * Who is signed in, for Client Components (header, menus, forms). The user is never read from a
 * token: it comes from GET /api/auth/me, or from a protected layout that already loaded it on the
 * server (`initialUser`). Public pages stay static, so the header resolves the user in the browser.
 */
export function AuthProvider({
  initialUser = null,
  children,
}: {
  initialUser?: UserProfile | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(initialUser);
  const [status, setStatus] = useState<AuthStatus>(
    initialUser ? 'authenticated' : 'loading',
  );

  const apply = useCallback((me: UserProfile | null) => {
    setUser(me);
    setStatus(me ? 'authenticated' : 'guest');
    return me;
  }, []);

  const reload = useCallback(() => fetchCurrentUser().then(apply), [apply]);

  useEffect(() => {
    if (initialUser) return;
    let cancelled = false;
    fetchCurrentUser().then((me) => {
      if (!cancelled) apply(me);
    });
    return () => {
      cancelled = true;
    };
  }, [initialUser, apply]);

  const signedIn = useCallback((next: UserProfile) => {
    setUser(next);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { auth: 'silent' });
    } finally {
      setUser(null);
      setStatus('guest');
      router.replace('/');
      router.refresh();
    }
  }, [router]);

  const value = useMemo(
    () => ({ user, status, reload, signedIn, logout }),
    [user, status, reload, signedIn, logout],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Drop into a protected layout to hand the user it loaded on the server to the client context, so
 * the header does not need a second /auth/me round trip.
 */
export function HydrateUser({ user }: { user: UserProfile }) {
  const { user: current, signedIn } = useAuth();
  useEffect(() => {
    if (current?.id !== user.id || current.role !== user.role) signedIn(user);
  }, [current, user, signedIn]);
  return null;
}
