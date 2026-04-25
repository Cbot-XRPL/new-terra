// Contract PDF generator using pdfkit. Outputs a printable agreement with
// the body, parties, and audit trail (signature/decline metadata when present).
//
// We stream into a Buffer rather than to disk so the route can either serve
// the file directly or, in the future, persist it once for email attachments.

import PDFDocument from 'pdfkit';

interface AuditUser {
  name: string;
}

export interface ContractPdfInput {
  templateName: string;
  body: string;
  customer: AuditUser & { email: string };
  createdBy: AuditUser;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  signatureName: string | null;
  signatureIp: string | null;
  declineReason: string | null;
  contractId: string;
}

export function renderContractPdf(input: ContractPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).text('New Terra Construction', { align: 'left' });
    doc.fontSize(10).fillColor('#666').text(input.templateName, { align: 'left' });
    doc.moveDown(0.5);
    doc.fillColor('#000');

    // Parties
    doc.fontSize(10);
    doc.text(`Customer: ${input.customer.name} <${input.customer.email}>`);
    doc.text(`Prepared by: ${input.createdBy.name}`);
    doc.text(`Contract ID: ${input.contractId}`);
    doc.text(`Status: ${input.status.toLowerCase()}`);
    doc.moveDown(1);

    // Divider
    doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
    doc.moveDown(0.6);

    // Body — preserve linebreaks; pdfkit will wrap long lines.
    doc.fontSize(11).font('Times-Roman').text(input.body, {
      align: 'left',
      lineGap: 2,
    });

    doc.moveDown(1.5);
    doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
    doc.moveDown(0.6);

    // Audit trail
    doc.font('Helvetica-Bold').fontSize(11).text('Audit trail');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Created ${input.createdAt.toISOString()} by ${input.createdBy.name}`);
    if (input.sentAt) doc.text(`Sent ${input.sentAt.toISOString()}`);
    if (input.viewedAt) doc.text(`Viewed by customer ${input.viewedAt.toISOString()}`);
    if (input.signedAt) {
      doc.font('Helvetica-Bold').text(`Signed ${input.signedAt.toISOString()}`);
      doc.font('Helvetica');
      if (input.signatureName) doc.text(`Signature (typed name): ${input.signatureName}`);
      if (input.signatureIp) doc.text(`Signature IP address: ${input.signatureIp}`);
    }
    if (input.declinedAt) {
      doc.font('Helvetica-Bold').text(`Declined ${input.declinedAt.toISOString()}`);
      doc.font('Helvetica');
      if (input.declineReason) doc.text(`Reason: ${input.declineReason}`);
    }

    doc.end();
  });
}
