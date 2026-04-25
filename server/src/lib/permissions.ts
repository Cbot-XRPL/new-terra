// Centralised role/capability checks for the construction-management features.
// Keeping these in one file makes it easy to audit who sees what.

import type { Project, Role, User } from '@prisma/client';

export function isStaffRole(role: Role): boolean {
  return role === 'ADMIN' || role === 'EMPLOYEE' || role === 'SUBCONTRACTOR';
}

export function hasSalesAccess(user: Pick<User, 'role' | 'isSales'>): boolean {
  return user.role === 'ADMIN' || (user.role === 'EMPLOYEE' && user.isSales);
}

export function hasProjectManagerCapability(
  user: Pick<User, 'role' | 'isProjectManager'>,
): boolean {
  return user.role === 'ADMIN' || (user.role === 'EMPLOYEE' && user.isProjectManager);
}

// Finance / accounting capabilities. Admins always pass; otherwise the
// EMPLOYEE must carry the isAccounting flag to see vendor + category
// management and the company-wide expense view.
export function hasAccountingAccess(
  user: Pick<User, 'role' | 'isAccounting'>,
): boolean {
  return user.role === 'ADMIN' || (user.role === 'EMPLOYEE' && user.isAccounting);
}

// Project managers can submit receipts (their job-cost workflow). Anyone with
// accounting access can also submit. Admins always pass.
export function canSubmitExpense(
  user: Pick<User, 'role' | 'isAccounting' | 'isProjectManager'>,
): boolean {
  return (
    user.role === 'ADMIN' ||
    (user.role === 'EMPLOYEE' && (user.isAccounting || user.isProjectManager))
  );
}

/**
 * True if the user can see / edit project-level data for this specific project.
 * - ADMIN: every project, full write
 * - EMPLOYEE PM (assigned): full write
 * - EMPLOYEE sales: read (and comment via the comments route's read gate) so
 *   reps can keep tabs on their accounts and help the PM coordinate with the
 *   customer; cannot edit project metadata or status
 * - The project's customer: read of their own project
 * Subcontractors and other employees fall through to the schedule lookup
 * elsewhere; this helper only governs the rich project hub.
 */
export function canManageProject(
  user: Pick<User, 'id' | 'role' | 'isProjectManager' | 'isSales'>,
  project: Pick<Project, 'projectManagerId' | 'customerId'>,
): { read: boolean; write: boolean } {
  if (user.role === 'ADMIN') return { read: true, write: true };
  if (user.role === 'EMPLOYEE' && user.isProjectManager && project.projectManagerId === user.id) {
    return { read: true, write: true };
  }
  if (user.role === 'EMPLOYEE' && user.isSales) {
    return { read: true, write: false };
  }
  if (user.role === 'CUSTOMER' && project.customerId === user.id) {
    return { read: true, write: false };
  }
  return { read: false, write: false };
}
