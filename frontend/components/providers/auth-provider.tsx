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
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/endpoints';
import { tokenStore, ApiError } from '@/lib/api/client';
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
  const router = useRouter();

  /** Resolve the stored token into a user, clearing it if it is no longer valid. */
  const refresh = React.useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await authApi.me());
    } catch (err) {
      // A rejected token is dead; anything else (API down) leaves the session
      // alone so a restarted backend does not sign the user out.
      if (err instanceof ApiError && err.isAuthError) {
        tokenStore.clear();
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = React.useCallback(async (email: string, password: string) => {
    const { token, user: signedIn } = await authApi.login({ email, password });
    tokenStore.set(token);
    setUser(signedIn);
    return signedIn;
  }, []);

  const register = React.useCallback(async (name: string, email: string, password: string) => {
    const { token, user: created } = await authApi.register({ name, email, password });
    tokenStore.set(token);
    setUser(created);
    return created;
  }, []);

  const logout = React.useCallback(() => {
    tokenStore.clear();
    setUser(null);
    router.push('/login');
  }, [router]);

  const can = React.useCallback(
    (role: UserRole) => Boolean(user && ROLE_RANK[user.role] >= ROLE_RANK[role]),
    [user]
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, loading, signedIn: Boolean(user), login, register, logout, refresh, can }),
    [user, loading, login, register, logout, refresh, can]
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
