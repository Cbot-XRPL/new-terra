// Payment receipt PDF generator using pdfkit. Mirrors contractPdf.ts —
// streams into a Buffer so the route can serve it directly or attach it
// to an email later without touching disk.

import PDFDocument from 'pdfkit';

export interface ReceiptPdfInput {
  receiptNumber: string;
  // Company info — pulled from CompanySettings; any field can be blank and
  // the renderer will skip it.
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
  customer: {
    name: string;
    email: string;
  };
  invoice: {
    number: string;
    amountCents: number;
    dueAt: Date | null;
    issuedAt: Date;
    project: { name: string } | null;
  };
  payment: {
    amountCents: number;
    method: string;
    referenceNumber: string | null;
    receivedAt: Date;
    notes: string | null;
    recordedByName: string | null;
  };
  // Running totals after this payment landed.
  totals: {
    paidCents: number;
    balanceCents: number;
    fullyPaid: boolean;
  };
}

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function joinAddress(input: ReceiptPdfInput['company']): string[] {
  const lines: string[] = [];
  if (input.addressLine1) lines.push(input.addressLine1);
  if (input.addressLine2) lines.push(input.addressLine2);
  const cityLine = [input.city, input.state, input.zip].filter(Boolean).join(input.city && input.state ? ', ' : ' ');
  if (cityLine) lines.push(cityLine);
  return lines;
}

export function renderReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header — company info on the left, RECEIPT badge on the right.
    const startY = doc.y;
    doc.fontSize(18).fillColor('#000').text(input.company.name, 56, startY);
    doc.fontSize(9).fillColor('#666');
    for (const line of joinAddress(input.company)) doc.text(line);
    if (input.company.phone) doc.text(input.company.phone);
    if (input.company.email) doc.text(input.company.email);
    if (input.company.websiteUrl) doc.text(input.company.websiteUrl);
    const headerEndY = doc.y;

    // Receipt block on the right
    doc.fillColor('#000').fontSize(22).text('PAYMENT RECEIPT', 320, startY, {
      width: 230,
      align: 'right',
    });
    doc.fontSize(10).fillColor('#666').text(`Receipt #: ${input.receiptNumber}`, 320, startY + 28, {
      width: 230,
      align: 'right',
    });
    doc.text(`Issued: ${input.payment.receivedAt.toLocaleDateString()}`, 320, startY + 42, {
      width: 230,
      align: 'right',
    });

    doc.y = Math.max(headerEndY, startY + 70) + 12;
    doc.x = 56;

    // Divider
    doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
    doc.moveDown(0.6);

    // Bill-to + invoice meta
    const colY = doc.y;
    doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Received from', 56, colY);
    doc.font('Helvetica').text(input.customer.name);
    doc.fillColor('#666').text(input.customer.email);

    doc.fillColor('#000').font('Helvetica-Bold').text('Applied to invoice', 320, colY);
    doc.font('Helvetica').text(`Invoice ${input.invoice.number}`);
    if (input.invoice.project) doc.text(`Project: ${input.invoice.project.name}`);
    doc.text(`Issued: ${input.invoice.issuedAt.toLocaleDateString()}`);
    if (input.invoice.dueAt) doc.text(`Due: ${input.invoice.dueAt.toLocaleDateString()}`);

    // Reset cursor below both columns.
    doc.x = 56;
    doc.y = Math.max(doc.y, colY + 80);
    doc.moveDown(1);

    // Payment block
    doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Payment details');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Method: ${formatMethod(input.payment.method)}`);
    if (input.payment.referenceNumber) {
      doc.text(`Reference: ${input.payment.referenceNumber}`);
    }
    doc.text(`Received: ${input.payment.receivedAt.toLocaleString()}`);
    if (input.payment.recordedByName) {
      doc.text(`Recorded by: ${input.payment.recordedByName}`);
    }
    if (input.payment.notes) {
      doc.text(`Notes: ${input.payment.notes}`);
    }

    doc.moveDown(0.5);

    // Big amount block
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1a73e8');
    doc.text(`Amount paid: ${dollars(input.payment.amountCents)}`, { align: 'left' });
    doc.fillColor('#000');
    doc.moveDown(0.5);

    // Running totals
    doc.font('Helvetica').fontSize(10);
    doc.text(`Invoice total: ${dollars(input.invoice.amountCents)}`);
    doc.text(`Total paid to date: ${dollars(input.totals.paidCents)}`);
    if (input.totals.fullyPaid) {
      doc.font('Helvetica-Bold').fillColor('#0f9d58');
      doc.text('Balance: $0.00 — paid in full', { continued: false });
      doc.fillColor('#000').font('Helvetica');
    } else {
      doc.text(`Balance remaining: ${dollars(input.totals.balanceCents)}`);
    }

    doc.moveDown(1);
    doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(8).fillColor('#666').text(
      'Thank you for your payment. Please retain this receipt for your records. ' +
      'If anything looks off, reply to the email this receipt was attached to (or contact us using the details above) and we will resolve it.',
      { align: 'left' },
    );

    doc.end();
  });
}

function formatMethod(m: string): string {
  switch (m) {
    case 'CASH': return 'Cash';
    case 'CHECK': return 'Check';
    case 'ZELLE': return 'Zelle';
    case 'ACH': return 'ACH transfer';
    case 'WIRE': return 'Wire transfer';
    case 'CARD': return 'Card';
    case 'STRIPE': return 'Card (Stripe)';
    case 'QUICKBOOKS': return 'QuickBooks';
    default: return m;
  }
}
