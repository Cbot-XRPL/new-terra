import { Router } from 'express';
import { z } from 'zod';
import { ContractStatus, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// {{name}} substitution. Whitespace-tolerant; missing variables render as
// "[name]" so it's obvious what wasn't filled in rather than failing silently.
function renderBody(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key: string) => {
    const v = values[key];
    return typeof v === 'string' && v.length > 0 ? v : `[${key}]`;
  });
}

interface VariableDef {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
}

const createSchema = z.object({
  templateId: z.string().min(1),
  customerId: z.string().min(1),
  variableValues: z.record(z.string()).default({}),
});

const updateSchema = z.object({
  variableValues: z.record(z.string()).optional(),
  status: z.enum([ContractStatus.VOID]).optional(),
});

const signSchema = z.object({ signatureName: z.string().min(2).max(120) });
const declineSchema = z.object({ reason: z.string().max(500).optional() });

function isSalesOrAdmin(role: Role, isSales: boolean) {
  return role === Role.ADMIN || (role === Role.EMPLOYEE && isSales);
}

async function loadMe(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

router.get('/', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    if (me.role === Role.CUSTOMER) {
      const contracts = await prisma.contract.findMany({
        // Customers don't see drafts that haven't been sent to them yet.
        where: {
          customerId: me.id,
          status: { in: [ContractStatus.SENT, ContractStatus.VIEWED, ContractStatus.SIGNED, ContractStatus.DECLINED] },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { id: true, name: true } },
          template: { select: { id: true, name: true } },
        },
      });
      return res.json({ contracts });
    }

    if (!isSalesOrAdmin(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Sales see their own; admins see everything.
    const where = me.role === Role.ADMIN ? {} : { createdById: me.id };
    const contracts = await prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
    });
    res.json({ contracts });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        template: { select: { id: true, name: true, variables: true } },
      },
    });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    if (me.role === Role.CUSTOMER) {
      if (contract.customerId !== me.id) return res.status(404).json({ error: 'Contract not found' });
      // Hide drafts.
      if (contract.status === ContractStatus.DRAFT) {
        return res.status(404).json({ error: 'Contract not found' });
      }
      // Stamp viewedAt on first customer view.
      if (contract.status === ContractStatus.SENT) {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { status: ContractStatus.VIEWED, viewedAt: new Date() },
        });
        contract.status = ContractStatus.VIEWED;
        contract.viewedAt = new Date();
      }
      return res.json({ contract });
    }

    if (!isSalesOrAdmin(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ contract });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !isSalesOrAdmin(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = createSchema.parse(req.body);

    const [template, customer] = await Promise.all([
      prisma.contractTemplate.findUnique({ where: { id: data.templateId } }),
      prisma.user.findUnique({ where: { id: data.customerId } }),
    ]);
    if (!template) return res.status(400).json({ error: 'Template not found' });
    if (!customer || customer.role !== Role.CUSTOMER) {
      return res.status(400).json({ error: 'customerId must reference a customer' });
    }

    const contract = await prisma.contract.create({
      data: {
        templateId: template.id,
        templateNameSnapshot: template.name,
        bodySnapshot: renderBody(template.body, data.variableValues),
        variableValues: data.variableValues,
        customerId: customer.id,
        createdById: me.id,
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    res.status(201).json({ contract });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !isSalesOrAdmin(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { template: true },
    });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Sales reps can only edit their own; admins edit anything.
    if (me.role !== Role.ADMIN && contract.createdById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (contract.status !== ContractStatus.DRAFT) {
      // Allow voiding a sent contract; otherwise lock edits.
      const data = updateSchema.parse(req.body);
      if (data.status === ContractStatus.VOID) {
        const voided = await prisma.contract.update({
          where: { id: contract.id },
          data: { status: ContractStatus.VOID },
        });
        return res.json({ contract: voided });
      }
      return res.status(409).json({ error: 'Cannot edit a sent contract' });
    }

    const data = updateSchema.parse(req.body);
    const values = (data.variableValues ?? (contract.variableValues as Record<string, string>)) as Record<string, string>;
    const body = contract.template
      ? renderBody(contract.template.body, values)
      : contract.bodySnapshot;

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        variableValues: values,
        bodySnapshot: body,
      },
    });
    res.json({ contract: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/send', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !isSalesOrAdmin(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { template: true },
    });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (me.role !== Role.ADMIN && contract.createdById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (contract.status !== ContractStatus.DRAFT) {
      return res.status(409).json({ error: `Already ${contract.status.toLowerCase()}` });
    }

    // Required-variables guard — tells the rep what's missing instead of
    // sending a contract with [unfilled_field] placeholders to the customer.
    if (contract.template) {
      const defs = (contract.template.variables as unknown as VariableDef[]) ?? [];
      const values = (contract.variableValues as Record<string, string>) ?? {};
      const missing = defs
        .filter((d) => d.required && !values[d.key])
        .map((d) => d.label || d.key);
      if (missing.length) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }
    }

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: { status: ContractStatus.SENT, sentAt: new Date() },
    });
    res.json({ contract: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/sign', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || me.role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only customers can sign' });
    }
    const data = signSchema.parse(req.body);
    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract || contract.customerId !== me.id) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    const signable: ContractStatus[] = [ContractStatus.SENT, ContractStatus.VIEWED];
    if (!signable.includes(contract.status)) {
      return res.status(409).json({ error: `Cannot sign a ${contract.status.toLowerCase()} contract` });
    }
    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.SIGNED,
        signedAt: new Date(),
        signatureName: data.signatureName,
        signatureIp: req.ip ?? null,
      },
    });
    res.json({ contract: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/decline', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || me.role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only customers can decline' });
    }
    const data = declineSchema.parse(req.body);
    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract || contract.customerId !== me.id) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    const declinable: ContractStatus[] = [ContractStatus.SENT, ContractStatus.VIEWED];
    if (!declinable.includes(contract.status)) {
      return res.status(409).json({ error: `Cannot decline a ${contract.status.toLowerCase()} contract` });
    }
    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.DECLINED,
        declinedAt: new Date(),
        declineReason: data.reason,
      },
    });
    res.json({ contract: updated });
  } catch (err) {
    next(err);
  }
});

// Sales-flow summary for admins: status counts + per-rep breakdown + stale list.
router.get('/admin/flow', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || me.role !== Role.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [byStatus, byRep, stale] = await Promise.all([
      prisma.contract.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.$queryRaw<Array<{ id: string; name: string; status: ContractStatus; count: bigint }>>`
        SELECT u."id", u."name", c."status", COUNT(*)::bigint AS count
        FROM "Contract" c
        JOIN "User" u ON u."id" = c."createdById"
        GROUP BY u."id", u."name", c."status"
        ORDER BY u."name" ASC
      `,
      prisma.contract.findMany({
        where: {
          status: { in: [ContractStatus.SENT, ContractStatus.VIEWED] },
          sentAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { sentAt: 'asc' },
        include: {
          customer: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        take: 25,
      }),
    ]);
    res.json({
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byRep: byRep.map((r) => ({ ...r, count: Number(r.count) })),
      stale,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
