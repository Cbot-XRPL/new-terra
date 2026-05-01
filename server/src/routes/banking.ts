import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { BankAccountKind, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// All banking surfaces are admin/accounting. Subs + customers + plain
// employees never see anything in here — it's the company's books.
async function gateAccounting(req: { user?: { sub: string } }, res: { status: (n: number) => { json: (b: unknown) => unknown } }) {
  const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!me || !hasAccountingAccess(me)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return me;
}

// ----- Bank accounts -----

const accountSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.nativeEnum(BankAccountKind).optional(),
  last4: z.string().max(8).nullable().optional(),
  institutionName: z.string().max(120).nullable().optional(),
  currentBalanceCents: z.number().int().optional(),
  isLiability: z.boolean().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.get('/accounts', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const accounts = await prisma.bankAccount.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    });
    res.json({ accounts });
  } catch (err) { next(err); }
});

router.post('/accounts', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = accountSchema.parse(req.body);
    const account = await prisma.bankAccount.create({
      data: {
        name: data.name,
        kind: data.kind ?? BankAccountKind.CHECKING,
        last4: data.last4 ?? null,
        institutionName: data.institutionName ?? null,
        currentBalanceCents: data.currentBalanceCents ?? 0,
        isLiability: data.isLiability ?? false,
        active: data.active ?? true,
        notes: data.notes ?? null,
      },
    });
    res.status(201).json({ account });
  } catch (err) { next(err); }
});

router.patch('/accounts/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = accountSchema.partial().parse(req.body);
    const account = await prisma.bankAccount.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        kind: data.kind,
        last4: data.last4 === null ? null : data.last4,
        institutionName: data.institutionName === null ? null : data.institutionName,
        currentBalanceCents: data.currentBalanceCents,
        isLiability: data.isLiability,
        active: data.active,
        notes: data.notes === null ? null : data.notes,
      },
    });
    res.json({ account });
  } catch (err) { next(err); }
});

router.delete('/accounts/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    // Soft-delete: archive instead of hard delete so existing transactions
    // keep their FK. Hard delete cascades to every transaction, which is
    // almost never what you want.
    await prisma.bankAccount.update({ where: { id: req.params.id }, data: { active: false } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ----- Bank transactions -----

const txSchema = z.object({
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  amountCents: z.number().int(),
  description: z.string().min(1).max(500),
  runningBalanceCents: z.number().int().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  matchedPaymentId: z.string().nullable().optional(),
  matchedExpenseId: z.string().nullable().optional(),
  matchedSubBillId: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  reconciled: z.boolean().optional(),
  // True = skip this row (no match needed); false = un-skip.
  matchSkipped: z.boolean().optional(),
});

const txQuery = z.object({
  accountId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  uncategorized: z.enum(['true', 'false']).optional(),
  unmatched: z.enum(['true', 'false']).optional(),
  unreconciled: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

router.get('/transactions', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const q = txQuery.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.accountId) where.accountId = q.accountId;
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    if (q.uncategorized === 'true') where.categoryId = null;
    if (q.unmatched === 'true') {
      where.matchedPaymentId = null;
      where.matchedExpenseId = null;
      where.matchedSubBillId = null;
    }
    if (q.unreconciled === 'true') where.reconciled = false;
    if (q.q) where.description = { contains: q.q, mode: 'insensitive' };
    const transactions = await prisma.bankTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: q.pageSize,
      include: {
        account: { select: { id: true, name: true, kind: true } },
        category: { select: { id: true, name: true } },
        matchedPayment: { select: { id: true, invoiceId: true, amountCents: true } },
        matchedExpense: { select: { id: true, description: true, amountCents: true } },
        matchedSubBill: { select: { id: true, number: true, amountCents: true } },
      },
    });
    res.json({ transactions });
  } catch (err) { next(err); }
});

router.post('/transactions', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const body = z.object({ accountId: z.string().min(1) }).extend(txSchema.shape).parse(req.body);
    const tx = await prisma.bankTransaction.create({
      data: {
        accountId: body.accountId,
        date: new Date(body.date),
        amountCents: body.amountCents,
        description: body.description,
        runningBalanceCents: body.runningBalanceCents ?? null,
        categoryId: body.categoryId ?? null,
        matchedPaymentId: body.matchedPaymentId ?? null,
        matchedExpenseId: body.matchedExpenseId ?? null,
        matchedSubBillId: body.matchedSubBillId ?? null,
        externalId: body.externalId ?? null,
        notes: body.notes ?? null,
        reconciled: body.reconciled ?? false,
        reconciledAt: body.reconciled ? new Date() : null,
      },
    });
    res.status(201).json({ transaction: tx });
  } catch (err) { next(err); }
});

router.patch('/transactions/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const body = txSchema.partial().parse(req.body);
    const existing = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });
    const reconciledChanged = body.reconciled !== undefined && body.reconciled !== existing.reconciled;
    const skipChanged = body.matchSkipped !== undefined &&
      !!body.matchSkipped !== !!existing.matchSkippedAt;
    const tx = await prisma.bankTransaction.update({
      where: { id: req.params.id },
      data: {
        date: body.date ? new Date(body.date) : undefined,
        amountCents: body.amountCents,
        description: body.description,
        runningBalanceCents: body.runningBalanceCents === null ? null : body.runningBalanceCents,
        categoryId: body.categoryId === null ? null : body.categoryId,
        matchedPaymentId: body.matchedPaymentId === null ? null : body.matchedPaymentId,
        matchedExpenseId: body.matchedExpenseId === null ? null : body.matchedExpenseId,
        matchedSubBillId: body.matchedSubBillId === null ? null : body.matchedSubBillId,
        notes: body.notes === null ? null : body.notes,
        reconciled: body.reconciled,
        reconciledAt: reconciledChanged ? (body.reconciled ? new Date() : null) : undefined,
        matchSkippedAt: skipChanged ? (body.matchSkipped ? new Date() : null) : undefined,
      },
    });
    res.json({ transaction: tx });
  } catch (err) { next(err); }
});

router.delete('/transactions/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    await prisma.bankTransaction.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ----- Match suggestions -----
//
// Given a bank transaction, find existing expenses / payments / sub-bills
// that probably represent the same dollar event so the admin can attach
// them in one tap instead of scrolling. Suggestions are scored by:
//
//   - Amount match (exact = strongest, ±$1 next, otherwise dropped).
//   - Date proximity (±7 days from the bank-tx date).
//   - Same paidFromAccountId on the Expense (a hint we lock in when the
//     PM uploads a receipt — "Chase ··1234" → only show Chase ··1234
//     transactions).
//   - Description hint — substring match against the bank-tx description.
//
// We return at most 8 candidates total so the UI doesn't drown the
// admin in choices. Already-matched bank-tx rows return an empty list.
// Score is shared between three candidate kinds. The threshold for an
// "auto-confident" match (used by the bulk auto-match endpoint) is high
// enough that only same-account + exact-cents + recent matches pass.
const AUTO_MATCH_SCORE = 100;

interface ScoredMatch {
  kind: 'expense' | 'payment' | 'subBill';
  score: number;
  expenseId?: string;
  paymentId?: string;
  subBillId?: string;
  // Display fields used by the client UI.
  date: Date;
  amountCents: number;
  label: string;
  meta?: string;
}

async function scoreMatches(tx: {
  id: string; accountId: string; amountCents: number; date: Date; description: string;
}): Promise<ScoredMatch[]> {
  const target = Math.abs(tx.amountCents);
  const minDate = new Date(tx.date.getTime() - 7 * 24 * 60 * 60 * 1000);
  const maxDate = new Date(tx.date.getTime() + 7 * 24 * 60 * 60 * 1000);
  const lcDesc = tx.description.toLowerCase();

  const [expenses, payments, subBills] = await Promise.all([
    prisma.expense.findMany({
      where: {
        amountCents: { gte: target - 100, lte: target + 100 },
        date: { gte: minDate, lte: maxDate },
        bankTransactions: { none: {} },
        OR: [{ paidFromAccountId: tx.accountId }, { paidFromAccountId: null }],
      },
      include: {
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        paidFromAccount: { select: { id: true, name: true, last4: true } },
      },
      take: 25,
    }),
    prisma.payment.findMany({
      where: {
        amountCents: { gte: target - 100, lte: target + 100 },
        receivedAt: { gte: minDate, lte: maxDate },
        bankTransactions: { none: {} },
      },
      include: { invoice: { select: { id: true, number: true, customer: { select: { name: true } } } } },
      take: 25,
    }),
    prisma.subcontractorBill.findMany({
      where: {
        amountCents: { gte: target - 100, lte: target + 100 },
        receivedAt: { gte: minDate, lte: maxDate },
        bankTransactions: { none: {} },
        // Only paid/approved sub-bills have a corresponding bank-tx outflow.
        status: { in: ['APPROVED', 'PAID'] },
      },
      include: {
        subcontractor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      take: 25,
    }),
  ]);

  const scored: ScoredMatch[] = [];

  for (const e of expenses) {
    let score = 0;
    if (e.paidFromAccountId === tx.accountId) score += 50;
    if (e.amountCents === target) score += 40;
    else score += Math.max(0, 30 - Math.abs(e.amountCents - target));
    const days = Math.abs((e.date.getTime() - tx.date.getTime()) / 86_400_000);
    score += Math.max(0, 20 - days * 3);
    if (e.vendor && lcDesc.includes(e.vendor.name.toLowerCase())) score += 30;
    scored.push({
      kind: 'expense',
      score,
      expenseId: e.id,
      date: e.date,
      amountCents: e.amountCents,
      label: e.vendor?.name ?? e.description ?? 'Expense',
      meta: [
        e.project?.name,
        e.paidFromAccount && `Paid from ${e.paidFromAccount.name}${e.paidFromAccount.last4 ? ` ··${e.paidFromAccount.last4}` : ''}`,
      ].filter(Boolean).join(' · '),
    });
  }

  for (const p of payments) {
    let score = 0;
    if (p.amountCents === target) score += 40;
    else score += Math.max(0, 30 - Math.abs(p.amountCents - target));
    const days = Math.abs((p.receivedAt.getTime() - tx.date.getTime()) / 86_400_000);
    score += Math.max(0, 20 - days * 3);
    if (p.invoice && lcDesc.includes(p.invoice.number.toLowerCase())) score += 30;
    if (p.invoice?.customer && lcDesc.includes(p.invoice.customer.name.toLowerCase())) score += 30;
    scored.push({
      kind: 'payment',
      score,
      paymentId: p.id,
      date: p.receivedAt,
      amountCents: p.amountCents,
      label: `Payment on ${p.invoice?.number ?? 'invoice'}`,
      meta: p.invoice?.customer?.name ?? '',
    });
  }

  for (const b of subBills) {
    let score = 0;
    if (b.amountCents === target) score += 40;
    else score += Math.max(0, 30 - Math.abs(b.amountCents - target));
    const days = Math.abs((b.receivedAt.getTime() - tx.date.getTime()) / 86_400_000);
    score += Math.max(0, 20 - days * 3);
    if (b.subcontractor && lcDesc.includes(b.subcontractor.name.toLowerCase())) score += 30;
    scored.push({
      kind: 'subBill',
      score,
      subBillId: b.id,
      date: b.receivedAt,
      amountCents: b.amountCents,
      label: `Sub bill ${b.number} · ${b.subcontractor.name}`,
      meta: b.project?.name ?? '',
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

router.get('/transactions/:id/suggestions', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const tx = await prisma.bankTransaction.findUnique({
      where: { id: req.params.id },
      include: { account: { select: { id: true, name: true, last4: true } } },
    });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.matchedExpenseId || tx.matchedPaymentId || tx.matchedSubBillId || tx.matchSkippedAt) {
      return res.json({ suggestions: [] });
    }
    const all = await scoreMatches(tx);
    res.json({ suggestions: all.slice(0, 8) });
  } catch (err) { next(err); }
});

// Bulk auto-match — runs scoring against every unmatched, un-skipped tx
// on the given account and applies any candidate that scores above the
// AUTO_MATCH_SCORE threshold. Returns a summary of how many fired.
router.post('/accounts/:id/auto-match', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const txs = await prisma.bankTransaction.findMany({
      where: {
        accountId: req.params.id,
        matchedExpenseId: null,
        matchedPaymentId: null,
        matchedSubBillId: null,
        matchSkippedAt: null,
      },
      take: 200,
    });
    let matched = 0;
    const skipped: string[] = [];
    for (const tx of txs) {
      const candidates = await scoreMatches(tx);
      const top = candidates[0];
      if (!top || top.score < AUTO_MATCH_SCORE) {
        skipped.push(tx.id);
        continue;
      }
      await prisma.bankTransaction.update({
        where: { id: tx.id },
        data: {
          matchedExpenseId: top.expenseId ?? null,
          matchedPaymentId: top.paymentId ?? null,
          matchedSubBillId: top.subBillId ?? null,
          reconciled: true,
          reconciledAt: new Date(),
        },
      });
      matched++;
    }
    res.json({ matched, scanned: txs.length, skipped: skipped.length });
  } catch (err) { next(err); }
});

// ----- CSV import -----
//
// Most US banks export CSVs that look like:
//   Date,Description,Amount[,Balance]
// or
//   Posting Date,Description,Debit,Credit[,Balance]
// We sniff both. amountCents is signed: positive = inflow. Returns counts
// for created / skipped (duplicate by externalId) / categorized (matched a
// rule). Re-importing the same file is idempotent: rows with the same
// externalId on the same account are skipped.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

interface ParsedRow {
  date: Date;
  description: string;
  amountCents: number;
  balanceCents?: number;
  externalId?: string;
}

// Tiny CSV parser tolerant of quoted fields with commas/escapes. Good enough
// for bank exports — they're well-formed.
function parseCsv(text: string): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') { inQuote = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); lines.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); lines.push(cur); }
  return lines.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function parseAmountCents(raw: string): number {
  // Strip $, commas, parens (negative). Empty → 0.
  const s = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!s) return 0;
  const isNeg = s.startsWith('(') && s.endsWith(')');
  const num = Number(isNeg ? s.slice(1, -1) : s);
  if (!Number.isFinite(num)) return 0;
  return Math.round((isNeg ? -num : num) * 100);
}

function parseDateLoose(raw: string): Date | null {
  // Support YYYY-MM-DD, MM/DD/YYYY, M/D/YY, MM-DD-YYYY.
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = Number(m[1]) - 1;
    const d = Number(m[2]);
    return new Date(Date.UTC(y, mo, d));
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.valueOf()) ? null : fallback;
}

function parseRows(rows: string[][]): { rows: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (rows.length < 2) return { rows: [], warnings: ['Empty file'] };
  const headerRow = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => names
    .map((n) => headerRow.indexOf(n))
    .find((i) => i !== -1);

  const dateIdx = idx(['date', 'posting date', 'posted date', 'transaction date']);
  const descIdx = idx(['description', 'memo', 'name', 'details', 'transaction description']);
  const amountIdx = idx(['amount', 'transaction amount']);
  const debitIdx = idx(['debit', 'withdrawal']);
  const creditIdx = idx(['credit', 'deposit']);
  const balanceIdx = idx(['balance', 'running balance']);
  const externalIdx = idx(['transaction id', 'reference', 'check number']);

  if (dateIdx === undefined || descIdx === undefined) {
    return { rows: [], warnings: ['Missing required Date or Description column'] };
  }
  if (amountIdx === undefined && (debitIdx === undefined || creditIdx === undefined)) {
    return { rows: [], warnings: ['Missing Amount or Debit/Credit columns'] };
  }

  const out: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.length < 2) continue;
    const date = parseDateLoose(r[dateIdx] ?? '');
    if (!date) {
      warnings.push(`Row ${i + 1}: unparseable date "${r[dateIdx]}"`);
      continue;
    }
    const description = (r[descIdx] ?? '').trim();
    if (!description) continue;
    let amountCents = 0;
    if (amountIdx !== undefined) {
      amountCents = parseAmountCents(r[amountIdx] ?? '');
    } else {
      const debit = debitIdx !== undefined ? parseAmountCents(r[debitIdx] ?? '') : 0;
      const credit = creditIdx !== undefined ? parseAmountCents(r[creditIdx] ?? '') : 0;
      amountCents = credit - Math.abs(debit); // debit is money out
    }
    const balance = balanceIdx !== undefined ? parseAmountCents(r[balanceIdx] ?? '') : undefined;
    const ext = externalIdx !== undefined ? (r[externalIdx] ?? '').trim() || undefined : undefined;
    out.push({ date, description, amountCents, balanceCents: balance, externalId: ext });
  }
  return { rows: out, warnings };
}

router.post('/accounts/:id/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const text = req.file.buffer.toString('utf8');
    const csv = parseCsv(text);
    const parsed = parseRows(csv);
    if (parsed.rows.length === 0) {
      return res.status(400).json({ error: 'No transactions parsed', warnings: parsed.warnings });
    }

    // Pull every active rule once so we don't N+1 per-row.
    const rules = await prisma.bankCategorizationRule.findMany({
      where: { active: true, OR: [{ accountId: null }, { accountId: account.id }] },
    });

    // Pre-fetch existing rows on this account in two batched queries so a
    // 500-row import is two reads + one createMany instead of 500 round
    // trips. Dedupe key is externalId when present; otherwise the
    // (date, amount, description) tuple — same fallback as before.
    const externalIds = parsed.rows
      .map((r) => r.externalId)
      .filter((id): id is string => !!id);
    const existingExternal = externalIds.length > 0
      ? new Set(
          (await prisma.bankTransaction.findMany({
            where: { accountId: account.id, externalId: { in: externalIds } },
            select: { externalId: true },
          })).map((t) => t.externalId).filter((x): x is string => !!x),
        )
      : new Set<string>();

    // For rows without an externalId, build a Set of "date|amount|desc"
    // composite keys we already have in the DB. We bound the date range to
    // the parsed window to keep the query small.
    const noExternal = parsed.rows.filter((r) => !r.externalId);
    let existingTuples = new Set<string>();
    if (noExternal.length > 0) {
      const minDate = noExternal.reduce((d, r) => r.date < d ? r.date : d, noExternal[0].date);
      const maxDate = noExternal.reduce((d, r) => r.date > d ? r.date : d, noExternal[0].date);
      const rows = await prisma.bankTransaction.findMany({
        where: {
          accountId: account.id,
          date: { gte: minDate, lte: maxDate },
        },
        select: { date: true, amountCents: true, description: true },
      });
      existingTuples = new Set(
        rows.map((t) => `${t.date.getTime()}|${t.amountCents}|${t.description}`),
      );
    }

    let created = 0;
    let skipped = 0;
    let categorized = 0;
    const toInsert: Array<{
      accountId: string;
      date: Date;
      amountCents: number;
      description: string;
      runningBalanceCents: number | null;
      categoryId: string | null;
      externalId: string | null;
    }> = [];

    for (const row of parsed.rows) {
      const isDupe = row.externalId
        ? existingExternal.has(row.externalId)
        : existingTuples.has(`${row.date.getTime()}|${row.amountCents}|${row.description}`);
      if (isDupe) { skipped += 1; continue; }

      const matched = rules.find((r) =>
        row.description.toLowerCase().includes(r.matchText.toLowerCase()),
      );
      toInsert.push({
        accountId: account.id,
        date: row.date,
        amountCents: row.amountCents,
        description: row.description,
        runningBalanceCents: row.balanceCents ?? null,
        categoryId: matched?.categoryId ?? null,
        externalId: row.externalId ?? null,
      });
      // Also push to the in-memory dedupe set so two duplicate rows in
      // the SAME upload don't both land.
      if (row.externalId) existingExternal.add(row.externalId);
      else existingTuples.add(`${row.date.getTime()}|${row.amountCents}|${row.description}`);

      created += 1;
      if (matched) categorized += 1;
    }

    if (toInsert.length > 0) {
      await prisma.bankTransaction.createMany({ data: toInsert });
    }

    audit(req, {
      action: 'banking.csv_imported',
      resourceType: 'bankAccount',
      resourceId: account.id,
      meta: { created, skipped, categorized },
    }).catch(() => undefined);

    res.json({ created, skipped, categorized, warnings: parsed.warnings });
  } catch (err) { next(err); }
});

// ----- Categorization rules -----

const ruleSchema = z.object({
  accountId: z.string().nullable().optional(),
  matchText: z.string().min(1).max(200),
  categoryId: z.string().min(1),
  vendorId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

router.get('/rules', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const rules = await prisma.bankCategorizationRule.findMany({
      orderBy: [{ active: 'desc' }, { matchText: 'asc' }],
      include: {
        account: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });
    res.json({ rules });
  } catch (err) { next(err); }
});

router.post('/rules', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = ruleSchema.parse(req.body);
    const rule = await prisma.bankCategorizationRule.create({
      data: {
        accountId: data.accountId ?? null,
        matchText: data.matchText,
        categoryId: data.categoryId,
        vendorId: data.vendorId ?? null,
        projectId: data.projectId ?? null,
        active: data.active ?? true,
      },
    });
    res.status(201).json({ rule });
  } catch (err) { next(err); }
});

router.patch('/rules/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = ruleSchema.partial().parse(req.body);
    const rule = await prisma.bankCategorizationRule.update({
      where: { id: req.params.id },
      data: {
        accountId: data.accountId === null ? null : data.accountId,
        matchText: data.matchText,
        categoryId: data.categoryId,
        vendorId: data.vendorId === null ? null : data.vendorId,
        projectId: data.projectId === null ? null : data.projectId,
        active: data.active,
      },
    });
    res.json({ rule });
  } catch (err) { next(err); }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    await prisma.bankCategorizationRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Run categorization rules across uncategorized transactions on demand.
// Useful after adding a new rule retroactively.
router.post('/rules/_apply', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const rules = await prisma.bankCategorizationRule.findMany({
      where: { active: true },
    });
    const txs = await prisma.bankTransaction.findMany({
      where: { categoryId: null },
      select: { id: true, accountId: true, description: true },
    });
    let updated = 0;
    for (const tx of txs) {
      const matched = rules.find((r) =>
        (r.accountId == null || r.accountId === tx.accountId)
        && tx.description.toLowerCase().includes(r.matchText.toLowerCase()),
      );
      if (matched) {
        await prisma.bankTransaction.update({
          where: { id: tx.id },
          data: { categoryId: matched.categoryId },
        });
        updated += 1;
      }
    }
    res.json({ updated, considered: txs.length });
  } catch (err) { next(err); }
});

// ----- Other assets / liabilities -----
//
// Flat CRUD for non-cash assets (vehicles, tools) and standalone liabilities
// (long-term loans). Both feed the balance-sheet rollup. Admin edits values
// directly — no depreciation engine.

const assetSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(80).nullable().optional(),
  currentValueCents: z.number().int().nonnegative().optional(),
  acquiredAt: z.string().datetime().nullable().optional(),
  acquisitionCostCents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
});

router.get('/assets', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const assets = await prisma.otherAsset.findMany({
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
    });
    res.json({ assets });
  } catch (err) { next(err); }
});

router.post('/assets', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = assetSchema.parse(req.body);
    const asset = await prisma.otherAsset.create({
      data: {
        name: data.name,
        category: data.category ?? null,
        currentValueCents: data.currentValueCents ?? 0,
        acquiredAt: data.acquiredAt ? new Date(data.acquiredAt) : null,
        acquisitionCostCents: data.acquisitionCostCents ?? null,
        notes: data.notes ?? null,
        archived: data.archived ?? false,
      },
    });
    res.status(201).json({ asset });
  } catch (err) { next(err); }
});

router.patch('/assets/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = assetSchema.partial().parse(req.body);
    const asset = await prisma.otherAsset.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        category: data.category === null ? null : data.category,
        currentValueCents: data.currentValueCents,
        acquiredAt: data.acquiredAt === null ? null : data.acquiredAt ? new Date(data.acquiredAt) : undefined,
        acquisitionCostCents: data.acquisitionCostCents === null ? null : data.acquisitionCostCents,
        notes: data.notes === null ? null : data.notes,
        archived: data.archived,
      },
    });
    res.json({ asset });
  } catch (err) { next(err); }
});

router.delete('/assets/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    await prisma.otherAsset.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

const liabilitySchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(80).nullable().optional(),
  currentBalanceCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
});

router.get('/liabilities', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const liabilities = await prisma.otherLiability.findMany({
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
    });
    res.json({ liabilities });
  } catch (err) { next(err); }
});

router.post('/liabilities', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = liabilitySchema.parse(req.body);
    const liability = await prisma.otherLiability.create({
      data: {
        name: data.name,
        category: data.category ?? null,
        currentBalanceCents: data.currentBalanceCents ?? 0,
        notes: data.notes ?? null,
        archived: data.archived ?? false,
      },
    });
    res.status(201).json({ liability });
  } catch (err) { next(err); }
});

router.patch('/liabilities/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    const data = liabilitySchema.partial().parse(req.body);
    const liability = await prisma.otherLiability.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        category: data.category === null ? null : data.category,
        currentBalanceCents: data.currentBalanceCents,
        notes: data.notes === null ? null : data.notes,
        archived: data.archived,
      },
    });
    res.json({ liability });
  } catch (err) { next(err); }
});

router.delete('/liabilities/:id', async (req, res, next) => {
  try {
    if (!await gateAccounting(req, res)) return;
    await prisma.otherLiability.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
