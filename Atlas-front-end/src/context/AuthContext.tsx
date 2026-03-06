'use client';

/**
 * src/context/AuthContext.tsx — ATLAS Authentication Context
 *
 * Provides the currently authenticated user's profile to the entire
 * dashboard without prop-drilling.
 *
 * On mount, fetches /api/auth/me using the stored JWT. If the request
 * fails (token expired / missing), the global 401 handler in apiFetch
 * redirects to /login automatically — no explicit check needed here.
 *
 * Usage:
 *   const { user, setUser, isAuthLoading } = useAuth();
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { apiGet } from '@/lib/api';

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: 'Admin' | 'Analyst' | 'Read-Only';
  phone?: string | null;
  avatar?: string | null;
  totp_enabled: boolean;
  invite_pending: boolean;
  created_at: string;
};

interface AuthContextType {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  isAuthLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const logout = () => {
    localStorage.removeItem('atlas_auth_token');
    setUser(null);
  };

  useEffect(() => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('atlas_auth_token')
        : null;

    if (!token) {
      setIsAuthLoading(false);
      return;
    }

    apiGet<AuthUser>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsAuthLoading(false));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, setUser, isAuthLoading, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
