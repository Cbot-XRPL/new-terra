import { describe, expect, it } from 'vitest';
import {
  canManageProject,
  canSubmitExpense,
  hasAccountingAccess,
  hasProjectManagerCapability,
  hasSalesAccess,
  isStaffRole,
} from './permissions.js';

// Tiny user / project factories so the assertions stay readable.
const user = (
  fields: Partial<{
    id: string;
    role: 'ADMIN' | 'EMPLOYEE' | 'SUBCONTRACTOR' | 'CUSTOMER';
    isSales: boolean;
    isProjectManager: boolean;
    isAccounting: boolean;
  }> = {},
) => ({
  id: 'u1',
  role: 'EMPLOYEE' as const,
  isSales: false,
  isProjectManager: false,
  isAccounting: false,
  ...fields,
});
const project = (fields: Partial<{ projectManagerId: string | null; customerId: string }> = {}) => ({
  projectManagerId: null,
  customerId: 'c1',
  ...fields,
});

describe('isStaffRole', () => {
  it.each([
    ['ADMIN', true],
    ['EMPLOYEE', true],
    ['SUBCONTRACTOR', true],
    ['CUSTOMER', false],
  ] as const)('%s → %s', (role, expected) => {
    expect(isStaffRole(role)).toBe(expected);
  });
});

describe('hasSalesAccess', () => {
  it('admin always passes', () => {
    expect(hasSalesAccess(user({ role: 'ADMIN' }))).toBe(true);
  });
  it('sales-flagged employee passes', () => {
    expect(hasSalesAccess(user({ role: 'EMPLOYEE', isSales: true }))).toBe(true);
  });
  it('plain employee fails', () => {
    expect(hasSalesAccess(user({ role: 'EMPLOYEE' }))).toBe(false);
  });
  it('customer fails even with isSales somehow set', () => {
    expect(hasSalesAccess({ role: 'CUSTOMER', isSales: true } as never)).toBe(false);
  });
});

describe('hasProjectManagerCapability', () => {
  it('admin passes', () => {
    expect(hasProjectManagerCapability(user({ role: 'ADMIN' }))).toBe(true);
  });
  it('PM-flagged employee passes', () => {
    expect(hasProjectManagerCapability(user({ role: 'EMPLOYEE', isProjectManager: true }))).toBe(true);
  });
  it('plain employee fails', () => {
    expect(hasProjectManagerCapability(user({ role: 'EMPLOYEE' }))).toBe(false);
  });
});

describe('hasAccountingAccess', () => {
  it('admin passes', () => {
    expect(hasAccountingAccess(user({ role: 'ADMIN' }))).toBe(true);
  });
  it('accounting-flagged employee passes', () => {
    expect(hasAccountingAccess(user({ role: 'EMPLOYEE', isAccounting: true }))).toBe(true);
  });
  it('plain employee fails', () => {
    expect(hasAccountingAccess(user({ role: 'EMPLOYEE' }))).toBe(false);
  });
});

describe('canSubmitExpense', () => {
  it('admin passes', () => {
    expect(canSubmitExpense(user({ role: 'ADMIN' }))).toBe(true);
  });
  it('PM employee passes', () => {
    expect(canSubmitExpense(user({ role: 'EMPLOYEE', isProjectManager: true }))).toBe(true);
  });
  it('accounting employee passes', () => {
    expect(canSubmitExpense(user({ role: 'EMPLOYEE', isAccounting: true }))).toBe(true);
  });
  it('plain employee fails', () => {
    expect(canSubmitExpense(user({ role: 'EMPLOYEE' }))).toBe(false);
  });
});

describe('canManageProject', () => {
  it('admin gets read+write on any project', () => {
    expect(canManageProject(user({ role: 'ADMIN' }), project())).toEqual({ read: true, write: true });
  });
  it('assigned PM gets read+write', () => {
    const me = user({ id: 'u1', role: 'EMPLOYEE', isProjectManager: true });
    expect(canManageProject(me, project({ projectManagerId: 'u1' }))).toEqual({ read: true, write: true });
  });
  it('any PM-flagged employee gets read+write on any project', () => {
    // Loosened from "assigned PM only" so shared / unassigned PM
    // workflows aren't blocked — see canManageProject.
    const me = user({ id: 'u1', role: 'EMPLOYEE', isProjectManager: true });
    expect(canManageProject(me, project({ projectManagerId: 'someone-else' }))).toEqual({
      read: true,
      write: true,
    });
  });
  it('sales-flagged employee reads any project but cannot write', () => {
    const me = user({ id: 'u1', role: 'EMPLOYEE', isSales: true });
    expect(canManageProject(me, project({ projectManagerId: 'pm-id' }))).toEqual({
      read: true,
      write: false,
    });
  });
  it('customer reads only their own project, never writes', () => {
    const me = { id: 'cust', role: 'CUSTOMER' as const, isProjectManager: false, isSales: false };
    expect(canManageProject(me, project({ customerId: 'cust' }))).toEqual({ read: true, write: false });
    expect(canManageProject(me, project({ customerId: 'someone-else' }))).toEqual({
      read: false,
      write: false,
    });
  });
  it('plain employee gets nothing', () => {
    expect(canManageProject(user({ role: 'EMPLOYEE' }), project())).toEqual({
      read: false,
      write: false,
    });
  });
});
