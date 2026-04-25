import { Router } from 'express';
import { z } from 'zod';
import { ExpenseSyncStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess } from '../lib/permissions.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchRecentPurchases,
  getActiveConnection,
  isQbConfigured,
  pushExpense,
  pushVendor,
} from '../lib/quickbooks.js';
import { env } from '../env.js';

const router = Router();

router.use(requireAuth);

async function loadMe(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

router.get('/status', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const configured = isQbConfigured();
    const connection = await getActiveConnection();

    const [queued, errored, synced, pending] = await Promise.all([
      prisma.expense.count({ where: { syncStatus: ExpenseSyncStatus.QUEUED } }),
      prisma.expense.count({ where: { syncStatus: ExpenseSyncStatus.ERROR } }),
      prisma.expense.count({ where: { syncStatus: ExpenseSyncStatus.SYNCED } }),
      prisma.expense.count({ where: { syncStatus: ExpenseSyncStatus.LOCAL_ONLY } }),
    ]);

    res.json({
      configured,
      connected: !!connection,
      stubMode: !configured,
      realmId: connection?.realmId ?? null,
      connectedAt: connection?.createdAt ?? null,
      accessTokenExpiresAt: connection?.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: connection?.refreshTokenExpiresAt ?? null,
      lastError: connection?.lastError ?? null,
      counts: { queued, errored, synced, localOnly: pending },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/authorize', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isQbConfigured()) {
      return res
        .status(400)
        .json({ error: 'QuickBooks not configured on this server. Set QB_CLIENT_ID, QB_CLIENT_SECRET, and QB_REDIRECT_URI.' });
    }
    // Bind the state to the user id so the callback can verify the same
    // accountant initiated the flow. Production should also bind to a
    // signed cookie for CSRF protection.
    const url = buildAuthorizeUrl(`u:${me.id}`);
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

const callbackQuery = z.object({
  code: z.string().min(1),
  realmId: z.string().min(1),
  state: z.string().min(1),
});

// Intuit redirects the *browser* here after the user grants consent.
// We don't require requireAuth on this endpoint because the redirect comes
// from Intuit, not the SPA. CSRF is mitigated by `state` containing the
// authorising user's id (admin/accounting only).
router.get(
  '/callback',
  // Pull off the requireAuth middleware that was applied at router-mount.
  (req, _res, next) => {
    (req as { user?: unknown }).user = undefined;
    next();
  },
  async (req, res, next) => {
    try {
      if (!isQbConfigured()) {
        return res
          .status(400)
          .send('QuickBooks not configured on this server. Set QB_CLIENT_ID / QB_CLIENT_SECRET / QB_REDIRECT_URI.');
      }
      const { code, realmId, state } = callbackQuery.parse(req.query);
      const userId = state.startsWith('u:') ? state.slice(2) : null;
      const me = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
      if (!me || !hasAccountingAccess(me)) {
        return res.status(403).send('Connection link is no longer valid.');
      }
      const connection = await exchangeCode({
        code,
        realmId,
        connectedById: me.id,
      });
      // Send the user back into the app rather than leaving them on a JSON
      // blob from /callback. APP_URL is the same value we use for invite URLs.
      res.redirect(`${env.appUrl}/portal/finance/qb?connected=${connection.realmId}`);
    } catch (err) {
      next(err);
    }
  },
);

router.post('/disconnect', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.qbConnection.deleteMany({});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ----- Sync -----

async function syncOneExpense(expenseId: string): Promise<{ ok: boolean; message?: string }> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { vendor: true },
  });
  if (!expense) return { ok: false, message: 'Expense not found' };

  // Vendor first — push if we have a vendor without a qbVendorId yet.
  let vendorQbId = expense.vendor?.qbVendorId ?? null;
  if (expense.vendor && !vendorQbId) {
    const vendorPush = await pushVendor({ name: expense.vendor.name });
    if (!vendorPush.ok) {
      await prisma.expense.update({
        where: { id: expense.id },
        data: {
          syncStatus: ExpenseSyncStatus.ERROR,
          lastSyncAttemptAt: new Date(),
          lastSyncError: `Vendor sync failed: ${vendorPush.error}`,
        },
      });
      return { ok: false, message: vendorPush.error };
    }
    vendorQbId = vendorPush.qbId;
    await prisma.vendor.update({
      where: { id: expense.vendor.id },
      data: { qbVendorId: vendorPush.qbId },
    });
  }

  const result = await pushExpense({
    amountCents: expense.amountCents,
    date: expense.date,
    description: expense.description ?? expense.notes ?? null,
    vendorQbId,
    memo: `nt-expense-id:${expense.id}`,
  });
  if (!result.ok) {
    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        syncStatus: ExpenseSyncStatus.ERROR,
        lastSyncAttemptAt: new Date(),
        lastSyncError: result.error,
      },
    });
    return { ok: false, message: result.error };
  }
  await prisma.expense.update({
    where: { id: expense.id },
    data: {
      syncStatus: ExpenseSyncStatus.SYNCED,
      qbExpenseId: result.qbId,
      lastSyncAttemptAt: new Date(),
      lastSyncError: null,
    },
  });
  return { ok: true };
}

router.post('/sync/expense/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await syncOneExpense(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.message ?? 'Sync failed' });
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: { select: { id: true, name: true, qbVendorId: true } },
      },
    });
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

router.post('/sync/queued', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const queued = await prisma.expense.findMany({
      where: { syncStatus: { in: [ExpenseSyncStatus.QUEUED, ExpenseSyncStatus.ERROR] } },
      select: { id: true },
      take: 100,
    });
    let succeeded = 0;
    let failed = 0;
    for (const e of queued) {
      const r = await syncOneExpense(e.id);
      if (r.ok) succeeded += 1;
      else failed += 1;
    }
    res.json({ considered: queued.length, succeeded, failed });
  } catch (err) {
    next(err);
  }
});

// Mark a LOCAL_ONLY expense as ready for the next sync run. Useful for
// queueing batches before the connection exists.
router.post('/expenses/:id/queue', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: { syncStatus: ExpenseSyncStatus.QUEUED },
    });
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

router.get('/recent-purchases', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const purchases = await fetchRecentPurchases(25);
    res.json({ purchases });
  } catch (err) {
    next(err);
  }
});

export default router;
