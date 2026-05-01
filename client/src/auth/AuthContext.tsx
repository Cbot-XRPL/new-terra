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
  isAccounting?: boolean;
  billingMode?: 'HOURLY' | 'DAILY';
  dailyRateCents?: number;
  hourlyRateCents?: number;
  avatarUrl?: string | null;
  avatarThumbnailUrl?: string | null;
  driversLicenseUrl?: string | null;
  contractorLicenseUrl?: string | null;
  businessLicenseUrl?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<AuthUser>;
  acceptInvite: (input: {
    token: string;
    name: string;
    password: string;
    phone?: string;
  }) => Promise<AuthUser>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    role?: 'CUSTOMER' | 'SUBCONTRACTOR';
    tradeType?: string;
  }) => Promise<AuthUser>;
  logout: () => void;
  // Profile + avatar updates call this so the cached user (and derived UI like
  // the nav avatar) updates without a full page reload.
  refreshUser: (next?: AuthUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'nt_token';

// Stash the token in sessionStorage when the user opted out of "Remember
// me" — clears as soon as the browser tab closes. localStorage persists
// indefinitely. The bootstrap reader checks both so existing logged-in
// users aren't kicked out by this change.
function readToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
}
function saveToken(token: string, remember: boolean): void {
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}
function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ user: AuthUser }>('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveToken(data.token, remember);
    setUser(data.user);
    return data.user;
  }, []);

  const acceptInvite = useCallback<AuthContextValue['acceptInvite']>(async (input) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    // Newly-accepted invites default to "remember" — they just set their
    // password, no point making them log in twice.
    saveToken(data.token, true);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback<AuthContextValue['register']>(async (input) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    saveToken(data.token, true);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
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
    () => ({ user, loading, login, acceptInvite, register, logout, refreshUser }),
    [user, loading, login, acceptInvite, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
