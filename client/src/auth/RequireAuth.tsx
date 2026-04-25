import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, type Role } from './AuthContext';

export function RequireAuth({
  children,
  roles,
  // When true, the page is only accessible to ADMINs and EMPLOYEEs flagged
  // as sales. Use this for the contract portal.
  salesAccess,
  // Same idea for project managers — admins always pass.
  pmAccess,
  // Finance dashboard gate — admin or EMPLOYEE flagged isAccounting. PMs and
  // sales reps reach the receipt-entry page through `submitExpense` instead.
  accountingAccess,
  // PM + accounting + admin can submit expenses (receipt uploads). Used for
  // the new-expense form so PMs in the field aren't blocked.
  submitExpense,
}: {
  children: ReactNode;
  roles?: Role[];
  salesAccess?: boolean;
  pmAccess?: boolean;
  accountingAccess?: boolean;
  submitExpense?: boolean;
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
  if (pmAccess && !(user.role === 'ADMIN' || (user.role === 'EMPLOYEE' && user.isProjectManager))) {
    return <Navigate to="/portal" replace />;
  }
  if (
    accountingAccess &&
    !(user.role === 'ADMIN' || (user.role === 'EMPLOYEE' && user.isAccounting))
  ) {
    return <Navigate to="/portal" replace />;
  }
  if (
    submitExpense &&
    !(
      user.role === 'ADMIN' ||
      (user.role === 'EMPLOYEE' && (user.isAccounting || user.isProjectManager))
    )
  ) {
    return <Navigate to="/portal" replace />;
  }
  return <>{children}</>;
}
