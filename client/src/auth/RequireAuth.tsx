import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, type Role } from './AuthContext';

export function RequireAuth({
  children,
  roles,
  // When true, the page is only accessible to ADMINs and EMPLOYEEs flagged
  // as sales. Use this for the contract portal.
  salesAccess,
}: {
  children: ReactNode;
  roles?: Role[];
  salesAccess?: boolean;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/portal" replace />;
  }
  if (salesAccess && !(user.role === 'ADMIN' || (user.role === 'EMPLOYEE' && user.isSales))) {
    return <Navigate to="/portal" replace />;
  }
  return <>{children}</>;
}
