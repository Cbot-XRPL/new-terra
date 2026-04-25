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

/**
 * True if the user can see / edit project-level data for this specific project.
 * - ADMIN: every project
 * - EMPLOYEE PM: only the projects they're assigned to
 * - The project's customer: their own project
 * Subcontractors and other employees fall through to the schedule lookup
 * elsewhere; this helper only governs the rich project hub.
 */
export function canManageProject(
  user: Pick<User, 'id' | 'role' | 'isProjectManager'>,
  project: Pick<Project, 'projectManagerId' | 'customerId'>,
): { read: boolean; write: boolean } {
  if (user.role === 'ADMIN') return { read: true, write: true };
  if (user.role === 'EMPLOYEE' && user.isProjectManager && project.projectManagerId === user.id) {
    return { read: true, write: true };
  }
  if (user.role === 'CUSTOMER' && project.customerId === user.id) {
    return { read: true, write: false };
  }
  // Other employees can read project metadata (already exposed via the
  // schedule list) but the rich hub is restricted to PMs + admin + customer.
  return { read: false, write: false };
}
