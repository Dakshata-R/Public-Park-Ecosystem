'use client';

/**
 * Session state for the whole application.
 *
 * The token lives in localStorage (see `lib/api/client.ts`); this provider
 * turns it into a `user` object and exposes the role checks the UI needs to
 * decide what to show. Authorisation is still enforced server-side — hiding a
 * button is a courtesy to the user, not a security control.
 */

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { authApi } from '@/lib/api/endpoints';
import { tokenStore, ApiError, SESSION_EXPIRED_EVENT } from '@/lib/api/client';
import type { User, UserRole } from '@/lib/types';

/** Same hierarchy the backend enforces in `middleware/auth.js`. */
const ROLE_RANK: Record<UserRole, number> = {
  citizen: 1,
  ecologist: 2,
  officer: 3,
  admin: 4,
};

interface AuthContextValue {
  user: User | null;
  /** True while the initial `/auth/me` check is in flight. */
  loading: boolean;
  signedIn: boolean;
  /**
   * Set when a stored session could not be checked because the API was
   * unreachable — the user is neither confirmed signed in nor signed out.
   */
  sessionError: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** True when the signed-in user holds at least `role`. */
  can: (role: UserRole) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  /** Resolve the stored token into a user, clearing it if it is no longer valid. */
  const refresh = React.useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setSessionError(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await authApi.me());
      setSessionError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.isAuthError || err.isForbidden)) {
        // A rejected or deactivated account is signed out.
        tokenStore.clear();
        setUser(null);
        setSessionError(null);
      } else {
        // API unreachable: keep the token so a restarted backend does not
        // sign the user out, but say why the session is not active.
        setSessionError(err instanceof Error ? err.message : 'Could not verify your session');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Another request found the token expired: sign out once, visibly.
  React.useEffect(() => {
    const onExpired = () => {
      setUser(null);
      queryClient.clear();
      toast.error('Your session has expired — please sign in again.');
      if (!pathname?.startsWith('/login')) {
        router.push(`/login?next=${encodeURIComponent(pathname || '/dashboard')}`);
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [pathname, queryClient, router]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const { token, user: signedIn } = await authApi.login({ email, password });
      // Nothing cached under the previous identity may leak into this one.
      queryClient.clear();
      tokenStore.set(token);
      setUser(signedIn);
      setSessionError(null);
      return signedIn;
    },
    [queryClient]
  );

  const register = React.useCallback(
    async (name: string, email: string, password: string) => {
      const { token, user: created } = await authApi.register({ name, email, password });
      queryClient.clear();
      tokenStore.set(token);
      setUser(created);
      setSessionError(null);
      return created;
    },
    [queryClient]
  );

  const logout = React.useCallback(() => {
    tokenStore.clear();
    setUser(null);
    // Per-user caches (my reports, my upvotes, admin data) must not survive
    // into the next person's session on a shared machine.
    queryClient.clear();
    router.push('/login');
  }, [queryClient, router]);

  const can = React.useCallback(
    (role: UserRole) => Boolean(user && ROLE_RANK[user.role] >= ROLE_RANK[role]),
    [user]
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, loading, signedIn: Boolean(user), sessionError, login, register, logout, refresh, can }),
    [user, loading, sessionError, login, register, logout, refresh, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>');
  return context;
}

/**
 * Render children only when the signed-in user holds `role`.
 * `fallback` shows in their place otherwise — usually nothing.
 */
export function RequireRole({
  role,
  children,
  fallback = null,
}: {
  role: UserRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = useAuth();
  return <>{can(role) ? children : fallback}</>;
}

/**
 * Only allow same-origin, path-only redirect targets. `?next=` comes from the
 * URL, so an absolute or protocol-relative value would be an open redirect.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/dashboard') {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
