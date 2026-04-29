// Plaid integration helpers. Mirrors the QuickBooks lib's shape: a
// shared client + sync function that hides Plaid's pagination so the
// route layer just calls `syncPlaidConnection(connection)` and gets
// back a count of new transactions.
//
// Configuration is opt-in via PLAID_CLIENT_ID + PLAID_SECRET env vars.
// When unset, every helper here returns null — the route layer surfaces
// "not configured" to the client and falls back to the CSV import flow.

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type Transaction as PlaidTxn,
  type RemovedTransaction,
} from 'plaid';
import { env } from '../env.js';
import { prisma } from '../db.js';

let _client: PlaidApi | null = null;

export function plaidConfigured(): boolean {
  return !!(env.plaid.clientId && env.plaid.secret);
}

export function plaidClient(): PlaidApi | null {
  if (!plaidConfigured()) return null;
  if (_client) return _client;
  const cfg = new Configuration({
    basePath: PlaidEnvironments[env.plaid.env] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': env.plaid.clientId,
        'PLAID-SECRET': env.plaid.secret,
      },
    },
  });
  _client = new PlaidApi(cfg);
  return _client;
}

// The Products our flow needs. 'transactions' is the workhorse;
// 'auth' lets us pull account/routing numbers later if we add Plaid-
// initiated payments.
export const PLAID_PRODUCTS: Products[] = [Products.Transactions];
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];

interface PlaidAccountSnapshot {
  accountId: string;
  mask: string | null;
  name: string;
  subtype: string | null;
  type: string;
}

/**
 * Convert Plaid's account `subtype` string into our BankAccountKind enum.
 * Plaid uses values like 'checking', 'savings', 'credit card', 'loan' —
 * almost everything else falls into OTHER.
 */
function bankKindFromPlaid(subtype: string | null, type: string): 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'LOAN' | 'OTHER' {
  const s = (subtype ?? '').toLowerCase();
  if (s === 'checking') return 'CHECKING';
  if (s === 'savings') return 'SAVINGS';
  if (s === 'credit card' || type === 'credit') return 'CREDIT_CARD';
  if (s === 'loan' || type === 'loan') return 'LOAN';
  return 'OTHER';
}

/**
 * Ensures every Plaid account on a connection has a matching BankAccount
 * row in our DB. Idempotent — re-runs match by `plaidAccountId` and
 * update name/last4/balance.
 */
export async function ensurePlaidAccounts(
  accessToken: string,
  institutionName: string | null,
): Promise<PlaidAccountSnapshot[]> {
  const client = plaidClient();
  if (!client) return [];

  const r = await client.accountsGet({ access_token: accessToken });
  const out: PlaidAccountSnapshot[] = [];
  for (const a of r.data.accounts) {
    const kind = bankKindFromPlaid(a.subtype ?? null, a.type);
    const balanceCents = Math.round((a.balances.current ?? 0) * 100);

    const existing = await prisma.bankAccount.findUnique({ where: { plaidAccountId: a.account_id } });
    if (existing) {
      await prisma.bankAccount.update({
        where: { id: existing.id },
        data: {
          name: a.name,
          last4: a.mask,
          institutionName: institutionName ?? existing.institutionName,
          currentBalanceCents: balanceCents,
        },
      });
    } else {
      await prisma.bankAccount.create({
        data: {
          name: a.name,
          kind,
          last4: a.mask ?? null,
          institutionName,
          currentBalanceCents: balanceCents,
          plaidAccountId: a.account_id,
        },
      });
    }
    out.push({
      accountId: a.account_id,
      mask: a.mask ?? null,
      name: a.name,
      subtype: a.subtype ?? null,
      type: a.type,
    });
  }
  return out;
}

/**
 * Run /transactions/sync against a connection's cursor, applying each
 * page of `added`/`modified`/`removed` transactions to BankTransaction
 * rows. Returns the new cursor + the number of net inserted/updated rows.
 *
 * Plaid's sync convention: amount > 0 = outflow (money out), amount < 0
 * = inflow (money in). Our BankTransaction.amountCents is the opposite
 * (positive = money in), so we negate.
 */
export async function syncPlaidConnection(connectionId: string): Promise<{
  added: number;
  modified: number;
  removed: number;
  cursor: string | null;
}> {
  const client = plaidClient();
  if (!client) throw new Error('Plaid not configured');

  const conn = await prisma.plaidConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error('Plaid connection not found');

  let cursor: string | undefined = conn.syncCursor ?? undefined;
  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let hasMore = true;

  while (hasMore) {
    const r = await client.transactionsSync({
      access_token: conn.accessToken,
      cursor,
      count: 500,
    });

    await applyPlaidPage(r.data.added, r.data.modified, r.data.removed);
    totalAdded += r.data.added.length;
    totalModified += r.data.modified.length;
    totalRemoved += r.data.removed.length;

    cursor = r.data.next_cursor;
    hasMore = r.data.has_more;
  }

  await prisma.plaidConnection.update({
    where: { id: conn.id },
    data: {
      syncCursor: cursor ?? null,
      lastSyncAt: new Date(),
      lastSyncCount: totalAdded + totalModified,
      lastError: null,
    },
  });

  return { added: totalAdded, modified: totalModified, removed: totalRemoved, cursor: cursor ?? null };
}

async function applyPlaidPage(
  added: PlaidTxn[],
  modified: PlaidTxn[],
  removed: RemovedTransaction[],
): Promise<void> {
  // Map Plaid account_id → our BankAccount.id, queried once per page.
  const plaidAcctIds = [
    ...new Set(
      [...added, ...modified].map((t) => t.account_id).filter((x): x is string => !!x),
    ),
  ];
  const accounts = plaidAcctIds.length
    ? await prisma.bankAccount.findMany({
        where: { plaidAccountId: { in: plaidAcctIds } },
        select: { id: true, plaidAccountId: true },
      })
    : [];
  const accountByPlaidId = new Map(
    accounts.map((a) => [a.plaidAccountId!, a.id] as const),
  );

  for (const t of added) {
    const accountId = accountByPlaidId.get(t.account_id);
    if (!accountId) continue; // Plaid account hasn't been ensured yet
    // Plaid sign convention is inverted from ours; negate.
    const amountCents = -Math.round(t.amount * 100);
    // Dedupe by (accountId, externalId) — re-running sync shouldn't
    // duplicate rows from the same Plaid transaction_id.
    const existing = await prisma.bankTransaction.findFirst({
      where: { accountId, externalId: t.transaction_id },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.bankTransaction.create({
      data: {
        accountId,
        date: new Date(t.date),
        amountCents,
        description: t.merchant_name ?? t.name ?? '(no description)',
        externalId: t.transaction_id,
      },
    });
  }

  for (const t of modified) {
    const accountId = accountByPlaidId.get(t.account_id);
    if (!accountId) continue;
    const amountCents = -Math.round(t.amount * 100);
    const existing = await prisma.bankTransaction.findFirst({
      where: { accountId, externalId: t.transaction_id },
      select: { id: true },
    });
    if (existing) {
      await prisma.bankTransaction.update({
        where: { id: existing.id },
        data: {
          date: new Date(t.date),
          amountCents,
          description: t.merchant_name ?? t.name ?? '(no description)',
        },
      });
    }
  }

  for (const r of removed) {
    if (!r.transaction_id) continue;
    await prisma.bankTransaction.deleteMany({
      where: { externalId: r.transaction_id },
    });
  }
}
