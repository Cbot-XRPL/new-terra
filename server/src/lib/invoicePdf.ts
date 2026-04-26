// Invoice PDF generator. Looks like the receipt PDF but renders line items
// (when present) and a footer with the company's payment instructions, so
// the customer has everything they need to pay sitting on a single page.

import PDFDocument from 'pdfkit';
import { prisma } from '../db.js';
import { computeTotals } from './payments.js';
import { getCompanySettings } from './companySettings.js';

export interface InvoiceLine {
  description: string;
  quantity?: number | null;
  unitCents?: number | null;
  totalCents: number;
}

export interface InvoicePdfInput {
  invoice: {
    number: string;
    issuedAt: Date;
    dueAt: Date | null;
    amountCents: number;
    paidCents: number;
    balanceCents: number;
    status: string;
    notes: string | null;
    lineItems: InvoiceLine[] | null;
    project: { name: string } | null;
    paymentUrl: string | null;
    requiresAcknowledgment: boolean;
    milestoneLabel: string | null;
  };
  customer: { name: string; email: string };
  company: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email: string | null;
    websiteUrl: string | null;
  };
  paymentInstructions: {
    paymentNotes: string | null;
    zelleEmail: string | null;
    zelleName: string | null;
    zellePhone: string | null;
    achInstructions: string | null;
    checkPayableTo: string | null;
    checkMailingAddress: string | null;
  };
}

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function joinAddress(c: InvoicePdfInput['company']): string[] {
  const lines: string[] = [];
  if (c.addressLine1) lines.push(c.addressLine1);
  if (c.addressLine2) lines.push(c.addressLine2);
  const cityLine = [c.city, c.state, c.zip].filter(Boolean).join(c.city && c.state ? ', ' : ' ');
  if (cityLine) lines.push(cityLine);
  return lines;
}

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Header ----
    const startY = doc.y;
    doc.fontSize(18).fillColor('#000').text(input.company.name, 56, startY);
    doc.fontSize(9).fillColor('#666');
    for (const line of joinAddress(input.company)) doc.text(line);
    if (input.company.phone) doc.text(input.company.phone);
    if (input.company.email) doc.text(input.company.email);
    if (input.company.websiteUrl) doc.text(input.company.websiteUrl);
    const headerEndY = doc.y;

    doc.fillColor('#000').fontSize(22).text('INVOICE', 320, startY, { width: 230, align: 'right' });
    doc.fontSize(10).fillColor('#666').text(`#${input.invoice.number}`, 320, startY + 28, {
      width: 230,
      align: 'right',
    });
    doc.text(`Issued: ${input.invoice.issuedAt.toLocaleDateString()}`, 320, startY + 42, {
      width: 230,
      align: 'right',
    });
    if (input.invoice.dueAt) {
      doc.text(`Due: ${input.invoice.dueAt.toLocaleDateString()}`, 320, startY + 56, {
        width: 230,
        align: 'right',
      });
    }
    doc.fontSize(11).fillColor(input.invoice.status === 'PAID' ? '#0f9d58' : '#1a73e8')
      .text(input.invoice.status.toLowerCase(), 320, startY + 72, { width: 230, align: 'right' });

    doc.y = Math.max(headerEndY, startY + 100);
    doc.x = 56;
    doc.fillColor('#000');

    doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
    doc.moveDown(0.6);

    // ---- Bill-to ----
    doc.font('Helvetica-Bold').fontSize(10).text('Bill to');
    doc.font('Helvetica');
    doc.text(input.customer.name);
    doc.fillColor('#666').text(input.customer.email);
    if (input.invoice.project) {
      doc.fillColor('#000').text(`Project: ${input.invoice.project.name}`);
    }
    doc.moveDown(1);

    // ---- Line items ----
    const hasLines = input.invoice.lineItems && input.invoice.lineItems.length > 0;
    if (hasLines) {
      const cols = { desc: 56, qty: 360, unit: 410, total: 480 };
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Description', cols.desc, doc.y);
      doc.text('Qty', cols.qty, doc.y - 12, { width: 40, align: 'right' });
      doc.text('Unit', cols.unit, doc.y - 12, { width: 60, align: 'right' });
      doc.text('Total', cols.total, doc.y - 12, { width: 70, align: 'right' });
      doc.moveDown(0.5);
      doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(10);
      for (const line of input.invoice.lineItems!) {
        const rowY = doc.y;
        doc.text(line.description, cols.desc, rowY, { width: 290 });
        const lineEndY = doc.y;
        if (line.quantity != null) {
          doc.text(String(line.quantity), cols.qty, rowY, { width: 40, align: 'right' });
        }
        if (line.unitCents != null) {
          doc.text(dollars(line.unitCents), cols.unit, rowY, { width: 60, align: 'right' });
        }
        doc.text(dollars(line.totalCents), cols.total, rowY, { width: 70, align: 'right' });
        doc.y = Math.max(doc.y, lineEndY);
        doc.moveDown(0.3);
      }
      doc.x = 56;
      doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
      doc.moveDown(0.5);
    }

    // ---- Totals box (right-aligned) ----
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    const totalsX = 380;
    const valX = 480;
    const valW = 70;
    const writeRow = (label: string, value: string, bold?: boolean) => {
      const y = doc.y;
      if (bold) doc.font('Helvetica-Bold');
      doc.text(label, totalsX, y);
      doc.text(value, valX, y, { width: valW, align: 'right' });
      doc.font('Helvetica');
      doc.moveDown(0.3);
    };
    writeRow('Invoice total', dollars(input.invoice.amountCents), true);
    if (input.invoice.paidCents > 0) {
      writeRow('Paid to date', dollars(input.invoice.paidCents));
      writeRow('Balance due', dollars(input.invoice.balanceCents), true);
    }
    doc.x = 56;
    doc.moveDown(1);

    if (input.invoice.notes) {
      doc.font('Helvetica-Bold').fontSize(10).text('Notes');
      doc.font('Helvetica').text(input.invoice.notes);
      doc.moveDown(1);
    }

    // ---- Payment instructions footer (only if there's still a balance) ----
    if (input.invoice.balanceCents > 0 && input.invoice.status !== 'VOID') {
      doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text('How to pay');
      doc.font('Helvetica').fontSize(9).fillColor('#444');

      if (input.invoice.requiresAcknowledgment) {
        doc.text(
          `Note: this invoice represents a milestone${
            input.invoice.milestoneLabel ? ` (${input.invoice.milestoneLabel})` : ''
          } that requires your sign-off in the customer portal before payment.`,
        );
        doc.moveDown(0.4);
      }

      const pi = input.paymentInstructions;
      if (pi.paymentNotes) {
        doc.text(pi.paymentNotes);
        doc.moveDown(0.3);
      }
      if (pi.zelleEmail || pi.zellePhone) {
        doc.font('Helvetica-Bold').text('Zelle:', { continued: true });
        doc.font('Helvetica');
        const parts = [pi.zelleName, pi.zelleEmail, pi.zellePhone].filter(Boolean);
        doc.text(` ${parts.join(' · ')}`);
      }
      if (pi.achInstructions) {
        doc.font('Helvetica-Bold').text('ACH:', { continued: true });
        doc.font('Helvetica').text(` ${pi.achInstructions}`);
      }
      if (pi.checkPayableTo || pi.checkMailingAddress) {
        doc.font('Helvetica-Bold').text('Check:', { continued: true });
        doc.font('Helvetica');
        if (pi.checkPayableTo) doc.text(` payable to ${pi.checkPayableTo}`);
        if (pi.checkMailingAddress) {
          doc.text(pi.checkMailingAddress);
        }
      }
      if (input.invoice.paymentUrl) {
        doc.moveDown(0.3);
        doc.fillColor('#1a73e8').text(`Pay online: ${input.invoice.paymentUrl}`);
        doc.fillColor('#444');
      }
    }

    doc.end();
  });
}

// Wrapper that pulls everything for a given invoice id and returns the PDF
// + a stable filename. Returns null if the invoice doesn't exist.
export async function buildInvoicePdf(invoiceId: string): Promise<{
  pdf: Buffer;
  filename: string;
} | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      project: { select: { name: true } },
      payments: { select: { amountCents: true } },
    },
  });
  if (!invoice) return null;
  const settings = await getCompanySettings();
  const totals = computeTotals(invoice.amountCents, invoice.payments.map((p) => p.amountCents));
  const pdf = await renderInvoicePdf({
    invoice: {
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      amountCents: invoice.amountCents,
      paidCents: totals.paidCents,
      balanceCents: totals.balanceCents,
      status: invoice.status,
      notes: invoice.notes,
      lineItems: (invoice.lineItems as InvoiceLine[] | null) ?? null,
      project: invoice.project,
      paymentUrl: invoice.paymentUrl,
      requiresAcknowledgment: invoice.requiresAcknowledgment,
      milestoneLabel: invoice.milestoneLabel,
    },
    customer: invoice.customer,
    company: {
      name: settings.companyName ?? 'New Terra Construction',
      addressLine1: settings.addressLine1,
      addressLine2: settings.addressLine2,
      city: settings.city,
      state: settings.state,
      zip: settings.zip,
      phone: settings.phone,
      email: settings.email,
      websiteUrl: settings.websiteUrl,
    },
    paymentInstructions: {
      paymentNotes: settings.paymentNotes,
      zelleEmail: settings.zelleEmail,
      zelleName: settings.zelleName,
      zellePhone: settings.zellePhone,
      achInstructions: settings.achInstructions,
      checkPayableTo: settings.checkPayableTo,
      checkMailingAddress: settings.checkMailingAddress,
    },
  });
  return { pdf, filename: `${invoice.number}.pdf` };
}
