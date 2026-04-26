// Global search — one endpoint that returns matches across projects,
// customers (User w/ role CUSTOMER), invoices, leads, and estimates.
// Customer/sub callers get scoped results (their own projects/invoices,
// their own leads where applicable). Staff with sales/admin/PM see
// everything.
//
// Substring match on the obvious display fields: project.name +
// project.address; customer.name + customer.email; invoice.number;
// lead.name + lead.email; estimate.number + estimate.title. Result cap
// per bucket is small (8) so the UI list stays scannable.

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

const PER_BUCKET = 8;

router.get('/', async (req, res, next) => {
  try {
    const q = z.object({ q: z.string().min(1).max(120) }).parse(req.query);
    const term = q.q.trim();
    if (term.length === 0) return res.json({ results: [] });
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    const isCustomer = me.role === Role.CUSTOMER;
    const isSub = me.role === Role.SUBCONTRACTOR;
    const isStaff = me.role === Role.ADMIN || (me.role === Role.EMPLOYEE && (hasSalesAccess(me) || me.isProjectManager || me.isAccounting));

    interface Hit {
      kind: 'project' | 'customer' | 'invoice' | 'lead' | 'estimate';
      id: string;
      title: string;
      subtitle?: string;
      href: string;
    }
    const results: Hit[] = [];

    // ---- Projects ----
    const projectWhere: Record<string, unknown> = {
      archivedAt: null,
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { address: { contains: term, mode: 'insensitive' } },
      ],
    };
    if (isCustomer) projectWhere.customerId = me.id;
    if (isSub) projectWhere.schedules = { some: { assigneeId: me.id } };
    const projects = await prisma.project.findMany({
      where: projectWhere,
      take: PER_BUCKET,
      include: { customer: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    for (const p of projects) {
      results.push({
        kind: 'project',
        id: p.id,
        title: p.name,
        subtitle: `${p.customer.name}${p.address ? ` · ${p.address}` : ''}`,
        href: `/portal/projects/${p.id}`,
      });
    }

    // ---- Invoices ----
    const invoiceWhere: Record<string, unknown> = {
      OR: [
        { number: { contains: term, mode: 'insensitive' } },
        { notes: { contains: term, mode: 'insensitive' } },
      ],
    };
    if (isCustomer) invoiceWhere.customerId = me.id;
    if (!isCustomer && !isStaff) {
      // Subs and plain employees don't see invoices.
      invoiceWhere.id = '__never__';
    }
    const invoices = await prisma.invoice.findMany({
      where: invoiceWhere,
      take: PER_BUCKET,
      include: { customer: { select: { name: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    for (const i of invoices) {
      results.push({
        kind: 'invoice',
        id: i.id,
        title: i.number,
        subtitle: `${i.customer.name} · ${i.status.toLowerCase()}`,
        href: '/portal/invoices',
      });
    }

    // ---- Customers (admin / sales-flagged staff only) ----
    if (me.role === Role.ADMIN || (me.role === Role.EMPLOYEE && hasSalesAccess(me))) {
      const customers = await prisma.user.findMany({
        where: {
          role: Role.CUSTOMER,
          isActive: true,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: PER_BUCKET,
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: 'desc' },
      });
      for (const c of customers) {
        results.push({
          kind: 'customer',
          id: c.id,
          title: c.name,
          subtitle: c.email,
          href: '/portal/admin', // no per-customer page yet; admin user list is the closest
        });
      }
    }

    // ---- Leads (sales + admin) ----
    if (me.role === Role.ADMIN || (me.role === Role.EMPLOYEE && hasSalesAccess(me))) {
      const leads = await prisma.lead.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { scope: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: PER_BUCKET,
        orderBy: { updatedAt: 'desc' },
      });
      for (const l of leads) {
        results.push({
          kind: 'lead',
          id: l.id,
          title: l.name,
          subtitle: `${l.status.toLowerCase()}${l.email ? ` · ${l.email}` : ''}`,
          href: `/portal/leads/${l.id}`,
        });
      }
    }

    // ---- Estimates ----
    const estimateWhere: Record<string, unknown> = {
      OR: [
        { number: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
      ],
    };
    if (isCustomer) estimateWhere.customerId = me.id;
    if (isSub) estimateWhere.id = '__never__';
    const estimates = await prisma.estimate.findMany({
      where: estimateWhere,
      take: PER_BUCKET,
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    for (const e of estimates) {
      results.push({
        kind: 'estimate',
        id: e.id,
        title: `${e.number} — ${e.title}`,
        subtitle: `${e.customer?.name ?? 'no customer'} · ${e.status.toLowerCase()}`,
        href: `/portal/estimates/${e.id}`,
      });
    }

    res.json({ results });
  } catch (err) { next(err); }
});

export default router;
