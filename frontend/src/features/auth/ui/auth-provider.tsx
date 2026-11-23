'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/shared/api/client';
import type { UserProfile } from '@/shared/api/types';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: UserProfile }
  | { status: 'guest'; user: null };

interface AuthContextValue {
  state: AuthState;
  /** Re-reads GET /api/auth/me, e.g. after login or a profile change. */
  reload: () => Promise<void>;
  /** POST /api/auth/logout (the API clears the cookies and revokes the session, ACC-06). */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Who is signed in, for client components (header, menus). The user comes only from GET
 * /api/auth/me; no token is stored anywhere in JavaScript (ACC-19). Pass `initialUser` when a Server
 * Component already loaded the session to skip the first request.
 */
export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser?: UserProfile | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>(() =>
    initialUser === undefined
      ? { status: 'loading', user: null }
      : initialUser
        ? { status: 'authenticated', user: initialUser }
        : { status: 'guest', user: null },
  );

  const reload = useCallback(async () => {
    try {
      const { data, response } = await api.GET('/api/auth/me');
      setState(
        response.ok && data
          ? { status: 'authenticated', user: data }
          : { status: 'guest', user: null },
      );
    } catch {
      setState({ status: 'guest', user: null });
    }
  }, []);

  useEffect(() => {
    // setState runs after the awaited request, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialUser === undefined) void reload();
  }, [initialUser, reload]);

  const logout = useCallback(async () => {
    try {
      await api.POST('/api/auth/logout');
    } finally {
      setState({ status: 'guest', user: null });
      router.replace('/');
      router.refresh();
    }
  }, [router]);

  const value = useMemo(
    () => ({ state, reload, logout }),
    [state, reload, logout],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
