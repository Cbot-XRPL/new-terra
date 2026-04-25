import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api';

export type Role = 'ADMIN' | 'EMPLOYEE' | 'SUBCONTRACTOR' | 'CUSTOMER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone?: string | null;
  isSales?: boolean;
  isProjectManager?: boolean;
  avatarUrl?: string | null;
  avatarThumbnailUrl?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  acceptInvite: (input: {
    token: string;
    name: string;
    password: string;
    phone?: string;
  }) => Promise<AuthUser>;
  logout: () => void;
  // Profile + avatar updates call this so the cached user (and derived UI like
  // the nav avatar) updates without a full page reload.
  refreshUser: (next?: AuthUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'nt_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ user: AuthUser }>('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const acceptInvite = useCallback<AuthContextValue['acceptInvite']>(async (input) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const refreshUser = useCallback<AuthContextValue['refreshUser']>(async (next) => {
    if (next) {
      setUser(next);
      return;
    }
    try {
      const data = await api<{ user: AuthUser }>('/api/auth/me');
      setUser(data.user);
    } catch {
      // ignored — fetch failure leaves the cached user in place
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, acceptInvite, logout, refreshUser }),
    [user, loading, login, acceptInvite, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
