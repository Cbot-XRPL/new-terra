// Job folder PDF — single multi-page document bundling everything on a
// project: cover page (project + customer info, status, dates), every
// estimate, every contract (body + audit trail), every invoice (with
// payments + balance), and a photo appendix.
//
// Built on top of pdfkit, mirrors the contract / receipt / invoice PDF
// generators stylistically. Photos are inlined via doc.image() — we
// fetch them from disk via the URL → path resolver from receiptOcr.

import path from 'node:path';
import fs from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import { prisma } from '../db.js';
import { getCompanySettings } from './companySettings.js';
import { computeTotals } from './payments.js';

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function resolveLocalPath(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/uploads/')) return null;
  return path.join(process.cwd(), url.replace(/^\/+/, ''));
}

async function safeStat(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function buildJobFolderPdf(projectId: string): Promise<{ pdf: Buffer; filename: string } | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      projectManager: { select: { id: true, name: true } },
      // 'estimates' relation on Project is `estimatesConverted` —
      // estimates that converted INTO this project. Plain customer
      // estimates without a project link won't appear here, which is
      // correct (they were never tied to this project).
      estimatesConverted: {
        orderBy: { createdAt: 'asc' },
        include: { lines: { orderBy: { position: 'asc' } } },
      },
      contracts: {
        orderBy: { createdAt: 'asc' },
      },
      invoices: {
        orderBy: { issuedAt: 'asc' },
        include: { payments: { orderBy: { receivedAt: 'asc' } } },
      },
      images: { orderBy: [{ takenAt: 'asc' }, { createdAt: 'asc' }] },
      changeOrders: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!project) return null;

  const settings = await getCompanySettings();

  // Pre-resolve which photos exist on disk so the renderer doesn't need
  // to await inside the Promise executor below.
  const resolvedPhotos: Array<{
    img: typeof project.images[number];
    localPath: string;
  }> = [];
  for (const img of project.images) {
    const localThumb = resolveLocalPath(img.thumbnailUrl);
    const localFull = resolveLocalPath(img.url);
    const tryPath = (localThumb && await safeStat(localThumb)) ? localThumb
      : (localFull && await safeStat(localFull)) ? localFull
      : null;
    if (tryPath) resolvedPhotos.push({ img, localPath: tryPath });
  }

  return new Promise<{ pdf: Buffer; filename: string }>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => {
      const slug = project.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';
      const stamp = new Date().toISOString().slice(0, 10);
      resolve({ pdf: Buffer.concat(chunks), filename: `job-folder-${slug}-${stamp}.pdf` });
    });
    doc.on('error', reject);

    const sectionHeader = (title: string) => {
      doc.addPage();
      doc.fontSize(18).fillColor('#1a73e8').text(title);
      doc.moveDown(0.3);
      doc.strokeColor('#cccccc').moveTo(56, doc.y).lineTo(556, doc.y).stroke();
      doc.moveDown(0.6);
      doc.fillColor('#000');
    };

    // ----- Cover page -----
    doc.addPage();
    doc.fontSize(24).fillColor('#000').text(settings.companyName ?? 'New Terra Construction');
    doc.fontSize(10).fillColor('#666');
    if (settings.addressLine1) doc.text(settings.addressLine1);
    if (settings.city || settings.state || settings.zip) {
      doc.text([settings.city, settings.state, settings.zip].filter(Boolean).join(', '));
    }
    if (settings.phone) doc.text(settings.phone);
    if (settings.email) doc.text(settings.email);

    doc.moveDown(2);
    doc.fontSize(28).fillColor('#000').text('Job Folder');
    doc.fontSize(16).fillColor('#666').text(project.name);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#000');
    doc.font('Helvetica-Bold').text('Customer:', { continued: true });
    doc.font('Helvetica').text(` ${project.customer.name} <${project.customer.email}>`);
    if (project.address) {
      doc.font('Helvetica-Bold').text('Address:', { continued: true });
      doc.font('Helvetica').text(` ${project.address}`);
    }
    if (project.projectManager) {
      doc.font('Helvetica-Bold').text('Project manager:', { continued: true });
      doc.font('Helvetica').text(` ${project.projectManager.name}`);
    }
    doc.font('Helvetica-Bold').text('Status:', { continued: true });
    doc.font('Helvetica').text(` ${project.status.toLowerCase()}`);
    if (project.startDate) {
      doc.font('Helvetica-Bold').text('Started:', { continued: true });
      doc.font('Helvetica').text(` ${project.startDate.toLocaleDateString()}`);
    }
    if (project.endDate) {
      doc.font('Helvetica-Bold').text('Completed:', { continued: true });
      doc.font('Helvetica').text(` ${project.endDate.toLocaleDateString()}`);
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#666').text(
      `Generated ${new Date().toLocaleString()}. Contains ${project.estimatesConverted.length} estimate(s), ` +
      `${project.contracts.length} contract(s), ${project.invoices.length} invoice(s), ` +
      `${project.changeOrders.length} change order(s), and ${project.images.length} photo(s).`,
    );

    // ----- Estimates -----
    if (project.estimatesConverted.length > 0) {
      sectionHeader('Estimates');
      for (const est of project.estimatesConverted) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(`${est.number} — ${est.title}`);
        doc.font('Helvetica').fontSize(10).fillColor('#666');
        doc.text(`Status: ${est.status.toLowerCase()} · Total: ${dollars(est.totalCents)}`);
        if (est.scope) doc.text(`Scope: ${est.scope}`);
        doc.moveDown(0.4);
        doc.fillColor('#000');
        if (est.lines.length > 0) {
          doc.fontSize(9);
          for (const line of est.lines) {
            const qty = line.quantity ? `${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : '';
            doc.text(`  · ${line.description}${qty ? ` — ${qty}` : ''} — ${dollars(line.totalCents)}`);
          }
        }
        doc.moveDown(0.6);
      }
    }

    // ----- Contracts -----
    if (project.contracts.length > 0) {
      sectionHeader('Contracts');
      for (const c of project.contracts) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(c.templateNameSnapshot);
        doc.font('Helvetica').fontSize(10).fillColor('#666');
        doc.text(`Status: ${c.status.toLowerCase()}`);
        if (c.signedAt) doc.text(`Signed ${c.signedAt.toISOString()} by ${c.signatureName ?? 'unknown'}`);
        if (c.declinedAt) doc.text(`Declined ${c.declinedAt.toISOString()}`);
        doc.moveDown(0.5);
        doc.fillColor('#000').font('Times-Roman').fontSize(10).text(c.bodySnapshot, { lineGap: 2 });
        doc.moveDown(1);
      }
    }

    // ----- Change orders -----
    if (project.changeOrders.length > 0) {
      sectionHeader('Change orders');
      for (const co of project.changeOrders) {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(`${co.number} — ${co.title}`);
        doc.font('Helvetica').fontSize(10).fillColor('#666');
        doc.text(`Status: ${co.status.toLowerCase()} · Amount: ${dollars(co.amountCents)}`);
        if (co.signedAt) doc.text(`Signed ${co.signedAt.toISOString()} by ${co.signatureName ?? 'unknown'}`);
        if (co.description) {
          doc.fillColor('#000').text(co.description);
        }
        doc.moveDown(0.6);
      }
    }

    // ----- Invoices -----
    if (project.invoices.length > 0) {
      sectionHeader('Invoices');
      for (const inv of project.invoices) {
        const totals = computeTotals(inv.amountCents, inv.payments.map((p) => p.amountCents));
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(`${inv.number}`);
        doc.font('Helvetica').fontSize(10).fillColor('#666');
        doc.text(
          `Status: ${inv.status.toLowerCase()} · Issued ${inv.issuedAt.toLocaleDateString()}` +
          `${inv.dueAt ? ` · Due ${inv.dueAt.toLocaleDateString()}` : ''}`,
        );
        doc.fillColor('#000');
        doc.text(`Amount: ${dollars(inv.amountCents)} · Paid: ${dollars(totals.paidCents)} · Balance: ${dollars(totals.balanceCents)}`);
        if (inv.payments.length > 0) {
          doc.fillColor('#666').fontSize(9);
          for (const p of inv.payments) {
            doc.text(
              `  · ${p.receivedAt.toLocaleDateString()} ${p.method.toLowerCase()}` +
              ` ${dollars(p.amountCents)}${p.referenceNumber ? ` (#${p.referenceNumber})` : ''}`,
            );
          }
          doc.fillColor('#000').fontSize(10);
        }
        if (inv.notes) doc.fillColor('#666').text(inv.notes).fillColor('#000');
        doc.moveDown(0.6);
      }
    }

    // ----- Photo appendix -----
    if (resolvedPhotos.length > 0) {
      sectionHeader('Photo appendix');
      // Two photos per page max, half-page tall. Pre-resolved above so the
      // renderer stays sync.
      let perPage = 0;
      for (const { img, localPath } of resolvedPhotos) {
        if (perPage >= 2) {
          doc.addPage();
          perPage = 0;
        }
        try {
          const before = doc.y;
          doc.image(localPath, { fit: [500, 320], align: 'center' });
          doc.y = Math.max(doc.y, before + 320);
          doc.fontSize(9).fillColor('#666');
          if (img.caption) doc.text(img.caption);
          const at = (img.takenAt ?? img.createdAt).toLocaleDateString();
          doc.text(`${img.phase ? `${img.phase} · ` : ''}${at}`);
          doc.fillColor('#000');
          doc.moveDown(0.5);
          perPage += 1;
        } catch (err) {
          console.warn('[job-folder] image embed failed', img.id, err);
        }
      }
    }

    doc.end();
  });
}
