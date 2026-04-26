// Receipt OCR via Tesseract.js. Loads the english language pack on first
// use (cached for the process lifetime), runs the image through OCR, and
// scans the resulting text for the most likely vendor + total.
//
// This is intentionally heuristic — receipts come in too many shapes for
// strict regex patterns. We pull obvious signals (the line containing
// "TOTAL"; the largest dollar value if no TOTAL; the first uppercase line
// near the top as the vendor) and let admin tweak before saving. When
// nothing matches we return nulls and let the existing manual flow
// continue.

import path from 'node:path';
import fs from 'node:fs/promises';
import { createWorker, type Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  return workerPromise;
}

export interface ReceiptExtraction {
  vendorGuess: string | null;
  totalCents: number | null;
  dateGuess: string | null; // ISO yyyy-mm-dd
  rawText: string;
}

const MONEY_RE = /\$?\s*(\d{1,4}(?:[,]\d{3})*\.\d{2})/g;

function pickTotal(lines: string[]): number | null {
  // Prefer a 'TOTAL' or 'GRAND TOTAL' line. Skip 'SUBTOTAL' which would
  // round down. Otherwise the largest standalone money figure on the page.
  let bestPriority: number | null = null;
  let bestVal: number | null = null;
  for (const raw of lines) {
    const upper = raw.toUpperCase();
    let priority = 0;
    if (upper.includes('GRAND TOTAL')) priority = 5;
    else if (/\bTOTAL\b/.test(upper) && !upper.includes('SUBTOTAL')) priority = 4;
    else if (upper.includes('AMOUNT DUE') || upper.includes('BALANCE')) priority = 3;
    else if (upper.includes('PAID')) priority = 2;
    if (priority > 0) {
      const matches = [...raw.matchAll(MONEY_RE)];
      if (matches.length > 0) {
        // Take the rightmost number on the line — receipts put the total
        // at the right edge of "TOTAL  $123.45".
        const last = matches[matches.length - 1][1];
        const cents = Math.round(Number(last.replace(/,/g, '')) * 100);
        if (Number.isFinite(cents) && cents > 0) {
          if (bestPriority === null || priority > bestPriority) {
            bestPriority = priority;
            bestVal = cents;
          }
        }
      }
    }
  }
  if (bestVal !== null) return bestVal;

  // Fallback: largest dollar amount on the receipt.
  let maxCents = 0;
  for (const raw of lines) {
    for (const m of raw.matchAll(MONEY_RE)) {
      const cents = Math.round(Number(m[1].replace(/,/g, '')) * 100);
      if (Number.isFinite(cents) && cents > maxCents) maxCents = cents;
    }
  }
  return maxCents > 0 ? maxCents : null;
}

function pickVendor(lines: string[]): string | null {
  // Receipts almost always print the merchant name in the first few non-
  // empty lines, often in all caps. Pull the first reasonable-looking
  // line (mostly letters, not all numbers, not generic 'RECEIPT' boilerplate).
  for (const raw of lines.slice(0, 8)) {
    const t = raw.trim();
    if (t.length < 3 || t.length > 60) continue;
    if (/^\d/.test(t)) continue; // probably an address line
    const letters = t.replace(/[^A-Za-z]/g, '').length;
    if (letters < 3) continue;
    if (/^(receipt|invoice|order|customer copy)$/i.test(t)) continue;
    return t;
  }
  return null;
}

const DATE_RE = /\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})\b/;
function pickDate(lines: string[]): string | null {
  for (const raw of lines) {
    const m = raw.match(DATE_RE);
    if (!m) continue;
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    if (y < 2000 || y > 2100) continue;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

export async function extractReceipt(filePath: string): Promise<ReceiptExtraction> {
  // Existence check — Tesseract throws an unhelpful error if the path is
  // bad, so we surface the missing file ourselves.
  await fs.access(filePath);
  const worker = await getWorker();
  const result = await worker.recognize(filePath);
  const text = result.data.text ?? '';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return {
    vendorGuess: pickVendor(lines),
    totalCents: pickTotal(lines),
    dateGuess: pickDate(lines),
    rawText: text,
  };
}

// Small helper for routes — given the public URL we stored on the Expense
// receipt (e.g. /uploads/expenses/abc.jpg), resolve to a disk path.
export function resolvePublicUrl(url: string): string {
  if (!url.startsWith('/uploads/')) return url;
  return path.join(process.cwd(), url.replace(/^\/+/, ''));
}
