// Admin-only routes for the regional pricing data feed. Mounted at
// /api/integrations/regional-pricing.
//
// Endpoints:
//   GET /labor               — paginated list, optional zipPrefix/socCode filters
//   GET /materials           — paginated list, optional productId/zipPrefix filters
//   POST /labor/import       — multipart CSV upload, upserts on (zip,soc,source)
//   POST /materials/import   — multipart CSV upload, inserts (history is the point)
//
// Why an in-house CSV splitter instead of pulling csv-parse:
//   The columns are simple (numeric / short string). Adding a dependency
//   for a 30-line parser isn't worth the supply-chain footprint on a
//   feature that admins use a couple of times a quarter.

import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireRole(Role.ADMIN));

const upload = multer({
  storage: multer.memoryStorage(),
  // 5 MB is plenty for these CSVs — BLS extracts hover around ~500 KB
  // even with every metro × every SOC.
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Tiny tolerant CSV splitter. Handles bare and double-quoted fields,
// embedded commas inside quotes, and "" escapes. Returns an array of
// rows, each row an array of trimmed strings. Blank lines collapse out.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
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
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows
    .map((r) => r.map((cell) => cell.trim()))
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function dollarsToCents(raw: string): number | null {
  if (raw === '' || raw == null) return null;
  // Strip $ and commas the user might've left in.
  const cleaned = raw.replace(/^\$/, '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeZipPrefix(raw: string): string | null {
  // Same rules as zipPrefixOf in regionalPricing.ts. Returns null when
  // the cell is empty so the importer can flag it as a row error.
  if (!raw) return null;
  const m = String(raw).match(/\d+/);
  if (!m) return null;
  const padded = m[0].padStart(3, '0').slice(0, 3);
  return padded.length === 3 ? padded : null;
}

// ----- list routes -----

router.get('/labor', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const where: Record<string, unknown> = {};
    if (typeof req.query.zipPrefix === 'string' && req.query.zipPrefix.trim()) {
      where.zipPrefix = req.query.zipPrefix.trim();
    }
    if (typeof req.query.socCode === 'string' && req.query.socCode.trim()) {
      where.socCode = req.query.socCode.trim();
    }
    const [rows, total] = await Promise.all([
      (prisma as any).laborWageRegion.findMany({
        where,
        orderBy: [{ fetchedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      (prisma as any).laborWageRegion.count({ where }),
    ]);
    res.json({ rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/materials', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const where: Record<string, unknown> = {};
    if (typeof req.query.productId === 'string' && req.query.productId.trim()) {
      where.productId = req.query.productId.trim();
    }
    if (typeof req.query.zipPrefix === 'string' && req.query.zipPrefix.trim()) {
      where.zipPrefix = req.query.zipPrefix.trim();
    }
    const [rows, total] = await Promise.all([
      (prisma as any).materialPriceSample.findMany({
        where,
        orderBy: [{ fetchedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { product: { select: { id: true, name: true, sku: true } } },
      }),
      (prisma as any).materialPriceSample.count({ where }),
    ]);
    res.json({ rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// ----- imports -----

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

router.post('/labor/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name "file")' });
    const text = req.file.buffer.toString('utf8');
    const rows = parseCsv(text);
    if (rows.length < 2) return res.status(400).json({ error: 'CSV is empty or header-only' });
    const header = rows[0].map((h) => h.toLowerCase());
    const idx = (name: string) => header.indexOf(name.toLowerCase());
    const zipIdx = idx('zipPrefix');
    const socIdx = idx('socCode');
    const wageIdx = idx('meanHourlyDollars');
    const metroIdx = idx('metroName');
    const sourceIdx = idx('source');
    if (zipIdx < 0 || socIdx < 0 || wageIdx < 0 || sourceIdx < 0) {
      return res.status(400).json({
        error: 'Missing required columns: zipPrefix, socCode, meanHourlyDollars, source',
      });
    }

    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];
      const zipPrefix = normalizeZipPrefix(r[zipIdx] ?? '');
      const socCode = (r[socIdx] ?? '').trim();
      const cents = dollarsToCents(r[wageIdx] ?? '');
      const source = (r[sourceIdx] ?? '').trim() || 'manual-csv';
      const metroName = metroIdx >= 0 ? (r[metroIdx] ?? '').trim() || null : null;
      if (!zipPrefix || !socCode || cents === null) {
        result.errors.push({ row: i + 1, reason: 'Missing zipPrefix / socCode / wage' });
        result.skipped += 1;
        continue;
      }
      try {
        await (prisma as any).laborWageRegion.upsert({
          where: { zipPrefix_socCode_source: { zipPrefix, socCode, source } },
          create: { zipPrefix, socCode, source, meanHourlyCents: cents, metroName },
          update: { meanHourlyCents: cents, metroName, fetchedAt: new Date() },
        });
        result.imported += 1;
      } catch (err) {
        result.errors.push({
          row: i + 1,
          reason: err instanceof Error ? err.message : 'upsert failed',
        });
        result.skipped += 1;
      }
    }

    audit(req, {
      action: 'regional_pricing.labor_import',
      meta: { imported: result.imported, skipped: result.skipped },
    }).catch(() => undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/materials/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name "file")' });
    const text = req.file.buffer.toString('utf8');
    const rows = parseCsv(text);
    if (rows.length < 2) return res.status(400).json({ error: 'CSV is empty or header-only' });
    const header = rows[0].map((h) => h.toLowerCase());
    const idx = (name: string) => header.indexOf(name.toLowerCase());
    const productIdx = idx('productId');
    const zipIdx = idx('zipPrefix');
    const priceIdx = idx('unitPriceDollars');
    const sourceIdx = idx('source');
    if (productIdx < 0 || zipIdx < 0 || priceIdx < 0 || sourceIdx < 0) {
      return res.status(400).json({
        error: 'Missing required columns: productId, zipPrefix, unitPriceDollars, source',
      });
    }

    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
    // Pre-validate that productIds exist so we don't blow up halfway
    // through a thousand-row CSV. Cheaper than a try/catch per row.
    const candidateIds = Array.from(
      new Set(rows.slice(1).map((r) => (r[productIdx] ?? '').trim()).filter(Boolean)),
    );
    const valid = await prisma.product.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true },
    });
    const validIds = new Set(valid.map((p) => p.id));

    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];
      const productId = (r[productIdx] ?? '').trim();
      const zipPrefix = normalizeZipPrefix(r[zipIdx] ?? '');
      const cents = dollarsToCents(r[priceIdx] ?? '');
      const source = (r[sourceIdx] ?? '').trim() || 'manual-csv';
      if (!productId || !zipPrefix || cents === null) {
        result.errors.push({ row: i + 1, reason: 'Missing productId / zipPrefix / price' });
        result.skipped += 1;
        continue;
      }
      if (!validIds.has(productId)) {
        result.errors.push({ row: i + 1, reason: `Unknown productId ${productId}` });
        result.skipped += 1;
        continue;
      }
      try {
        await (prisma as any).materialPriceSample.create({
          data: { productId, zipPrefix, unitPriceCents: cents, source },
        });
        result.imported += 1;
      } catch (err) {
        result.errors.push({
          row: i + 1,
          reason: err instanceof Error ? err.message : 'insert failed',
        });
        result.skipped += 1;
      }
    }

    audit(req, {
      action: 'regional_pricing.materials_import',
      meta: { imported: result.imported, skipped: result.skipped },
    }).catch(() => undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
