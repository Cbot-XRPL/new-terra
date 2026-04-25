import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, type Role } from './AuthContext';

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/portal" replace />;
  }
  return <>{children}</>;
}
