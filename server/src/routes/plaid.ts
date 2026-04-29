import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { Products, CountryCode } from 'plaid';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  ensurePlaidAccounts,
  plaidClient,
  plaidConfigured,
  syncPlaidConnection,
} from '../lib/plaid.js';

const router = Router();
router.use(requireAuth);

// Status — returns connection summary + whether server-side keys exist.
// Banking page hits this on mount to decide between "Connect bank" CTA
// and "Connected to Chase · last synced 5m ago".
router.get('/status', async (_req, res, next) => {
  try {
    const configured = plaidConfigured();
    const connections = await prisma.plaidConnection.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        institutionName: true,
        institutionId: true,
        accounts: true,
        lastSyncAt: true,
        lastSyncCount: true,
        lastError: true,
        createdAt: true,
      },
    });
    res.json({ configured, connections });
  } catch (err) {
    next(err);
  }
});

// Mint a Link token to hand the frontend Plaid Link modal. Admin/accounting
// only; subcontractors and customers don't get to wire bank accounts.
router.post('/link-token', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const client = plaidClient();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured. Set PLAID_CLIENT_ID + PLAID_SECRET in the server .env.' });
    }
    const me = req.user!;
    // Optional: pass an existing access_token to "update" mode for re-auth
    // when a connection's credentials expire (Plaid throws an ITEM_LOGIN_REQUIRED).
    const updateForId = z.object({ connectionId: z.string().optional() }).parse(req.body ?? {}).connectionId;
    let accessToken: string | undefined;
    if (updateForId) {
      const conn = await prisma.plaidConnection.findUnique({ where: { id: updateForId } });
      if (conn) accessToken = conn.accessToken;
    }

    const r = await client.linkTokenCreate({
      user: { client_user_id: me.sub },
      client_name: 'New Terra Construction',
      products: accessToken ? undefined : [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      access_token: accessToken,
    });
    res.json({ linkToken: r.data.link_token, expiration: r.data.expiration });
  } catch (err: any) {
    // Surface Plaid error messages to the admin so they know what to fix.
    const msg = err?.response?.data?.error_message ?? err?.message ?? 'Plaid link-token failed';
    res.status(502).json({ error: msg });
    next();
  }
});

// Exchange the public_token (from Plaid Link's onSuccess callback) for a
// long-lived access_token + item_id, then immediately seed accounts +
// pull initial transactions.
router.post('/exchange', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const client = plaidClient();
    if (!client) return res.status(503).json({ error: 'Plaid not configured' });
    const { publicToken, institutionId, institutionName } = z
      .object({
        publicToken: z.string().min(1),
        institutionId: z.string().optional(),
        institutionName: z.string().optional(),
      })
      .parse(req.body);

    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });

    const conn = await prisma.plaidConnection.create({
      data: {
        itemId: exchange.data.item_id,
        accessToken: exchange.data.access_token,
        institutionId: institutionId ?? null,
        institutionName: institutionName ?? null,
        connectedById: req.user!.sub,
      },
    });

    // Fetch + persist account list so the UI can show "Chase Checking ··1234"
    // immediately, even before the first transaction sync completes.
    try {
      const accounts = await ensurePlaidAccounts(conn.accessToken, institutionName ?? null);
      await prisma.plaidConnection.update({
        where: { id: conn.id },
        data: { accounts: accounts as unknown as object },
      });
    } catch (err: any) {
      await prisma.plaidConnection.update({
        where: { id: conn.id },
        data: { lastError: err?.message ?? 'accountsGet failed' },
      });
    }

    // Kick off the first sync. Plaid takes a moment to populate transactions
    // for a freshly-linked item, but /transactions/sync handles that with a
    // 'has_more' loop and an eventual empty cursor.
    syncPlaidConnection(conn.id).catch((err) => {
      void prisma.plaidConnection.update({
        where: { id: conn.id },
        data: { lastError: err?.message ?? 'initial sync failed' },
      });
    });

    res.status(201).json({ connection: { id: conn.id, institutionName: conn.institutionName } });
  } catch (err: any) {
    const msg = err?.response?.data?.error_message ?? err?.message ?? 'Plaid exchange failed';
    res.status(502).json({ error: msg });
    next();
  }
});

router.post('/:id/sync', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    if (!plaidConfigured()) return res.status(503).json({ error: 'Plaid not configured' });
    const result = await syncPlaidConnection(req.params.id);
    res.json(result);
  } catch (err: any) {
    const msg = err?.response?.data?.error_message ?? err?.message ?? 'Plaid sync failed';
    res.status(502).json({ error: msg });
    next();
  }
});

router.delete('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const conn = await prisma.plaidConnection.findUnique({ where: { id: req.params.id } });
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    // Best-effort revoke at Plaid so credentials get invalidated on their
    // side too. Failure here doesn't block our local removal.
    const client = plaidClient();
    if (client) {
      await client
        .itemRemove({ access_token: conn.accessToken })
        .catch(() => undefined);
    }
    // Detach the BankAccount rows so historical transactions stay readable
    // but the next Plaid link doesn't collide on plaidAccountId.
    await prisma.bankAccount.updateMany({
      where: { plaidAccountId: { not: null } },
      data: { plaidAccountId: null },
    });
    await prisma.plaidConnection.delete({ where: { id: conn.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
