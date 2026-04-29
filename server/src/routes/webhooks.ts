import crypto from 'node:crypto';
import express, { Router } from 'express';
import { ContractStatus, InvoiceStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '../db.js';
import { mapEnvelopeStatus, verifyConnectSignature } from '../lib/docusign.js';
import { sendContractDecidedEmail } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { recomputeInvoiceStatus } from '../lib/payments.js';
import { syncPlaidConnection } from '../lib/plaid.js';

const router = Router();

// Webhooks bypass our normal JSON middleware so we can verify the HMAC
// against the exact bytes the sender signed. Cap at 5 MB to leave headroom
// for Connect events that include attached documents.
router.use(express.raw({ type: 'application/json', limit: '5mb' }));

interface ConnectEvent {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: {
      status?: string;
      customFields?: {
        textCustomFields?: Array<{ name?: string; value?: string }>;
      };
      recipients?: {
        signers?: Array<{
          status?: string;
          declinedReason?: string;
          signedDateTime?: string;
        }>;
      };
    };
  };
}

router.post('/docusign', async (req, res, next) => {
  try {
    const raw = req.body as Buffer;
    const signature = req.header('X-DocuSign-Signature-1') ?? req.header('x-docusign-signature-1');
    if (!verifyConnectSignature(raw, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event: ConnectEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as ConnectEvent;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const envelopeId = event.data?.envelopeId;
    const status = event.data?.envelopeSummary?.status;
    const customFields = event.data?.envelopeSummary?.customFields?.textCustomFields ?? [];
    const contractIdField = customFields.find((f) => f.name === 'newterra_contract_id');
    const contractId = contractIdField?.value;

    if (!envelopeId || !contractId) {
      // Acknowledge with 200 so DocuSign doesn't retry; log so we can debug.
      console.warn('[docusign:webhook] missing envelopeId or contract id', { envelopeId });
      return res.json({ ok: true, ignored: true });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (!contract || contract.docusignEnvelopeId !== envelopeId) {
      console.warn('[docusign:webhook] no matching contract for envelope', envelopeId);
      return res.json({ ok: true, ignored: true });
    }

    const mapped = mapEnvelopeStatus(status);
    if (!mapped.contractStatus) {
      // Just record the latest envelope status text without changing
      // contract state (e.g. envelope-resent intermediate events).
      await prisma.contract.update({
        where: { id: contract.id },
        data: { docusignStatus: status ?? null },
      });
      return res.json({ ok: true });
    }

    const now = new Date();
    const declinedReason = event.data?.envelopeSummary?.recipients?.signers?.find(
      (s) => s.status?.toLowerCase() === 'declined',
    )?.declinedReason;

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: mapped.contractStatus as ContractStatus,
        docusignStatus: status ?? null,
        signedAt: mapped.contractStatus === 'SIGNED' ? now : contract.signedAt,
        signatureName:
          mapped.contractStatus === 'SIGNED'
            ? contract.signatureName ?? `Signed via DocuSign (${contract.customer.name})`
            : contract.signatureName,
        declinedAt: mapped.contractStatus === 'DECLINED' ? now : contract.declinedAt,
        declineReason:
          mapped.contractStatus === 'DECLINED'
            ? declinedReason ?? contract.declineReason ?? 'Declined via DocuSign'
            : contract.declineReason,
      },
    });

    // Notify the rep on terminal events.
    if (mapped.contractStatus === 'SIGNED' || mapped.contractStatus === 'DECLINED') {
      sendContractDecidedEmail({
        to: contract.createdBy.email,
        repName: contract.createdBy.name,
        customerName: contract.customer.name,
        contractName: contract.templateNameSnapshot,
        contractId: contract.id,
        outcome: mapped.contractStatus === 'SIGNED' ? 'signed' : 'declined',
        declineReason: updated.declineReason,
      }).catch((err) => console.warn('[docusign:webhook] notice email failed', err));
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Stripe ----
//
// Verifies signatures the same way Stripe's SDK does internally (HMAC-SHA256
// over `${timestamp}.${payload}`). Skips verification when STRIPE_WEBHOOK_SECRET
// isn't set so local dev can post mock events through curl. Production must
// set the secret.
//
// We listen for two events:
//   - payment_intent.succeeded — flips an invoice with metadata.invoiceId to PAID
//   - checkout.session.completed — same, when the rep used a Checkout link
//
// Either event can include an Invoice id either via metadata.invoiceId or
// metadata.nt_invoice_id (older convention). Both are accepted.

interface StripeEventLike {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  // Header format: t=1614265330,v1=hex,v0=hex
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const signedPayload = `${parts.t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function pickInvoiceId(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  const a = typeof meta.invoiceId === 'string' ? meta.invoiceId : undefined;
  const b = typeof meta.nt_invoice_id === 'string' ? meta.nt_invoice_id : undefined;
  return a ?? b;
}

router.post('/stripe', async (req, res, next) => {
  try {
    const raw = req.body as Buffer;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = req.header('Stripe-Signature') ?? req.header('stripe-signature');
    if (secret && !verifyStripeSignature(raw, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event: StripeEventLike;
    try {
      event = JSON.parse(raw.toString('utf8')) as StripeEventLike;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const obj = (event.data?.object ?? {}) as {
      metadata?: Record<string, unknown>;
      amount_received?: number;
      amount_total?: number;
    };
    const invoiceId = pickInvoiceId(obj.metadata);

    if (!invoiceId) {
      // Acknowledge so Stripe doesn't retry; we just don't have a local row.
      return res.json({ ok: true, ignored: 'no invoiceId metadata' });
    }

    const eventsThatMarkPaid = new Set([
      'payment_intent.succeeded',
      'checkout.session.completed',
      'invoice.paid',
    ]);
    if (!event.type || !eventsThatMarkPaid.has(event.type)) {
      return res.json({ ok: true, ignored: `unhandled event type: ${event.type ?? 'unknown'}` });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      return res.json({ ok: true, ignored: 'no matching invoice' });
    }
    if (invoice.status === InvoiceStatus.VOID) {
      return res.json({ ok: true, ignored: 'invoice voided' });
    }

    // Stripe sends both checkout.session.completed and payment_intent.succeeded
    // for the same checkout — same id surfaces in either as event.data.object.id
    // for sessions or .payment_intent for intents. We dedupe on the most stable
    // value we have (the event id), persisted as the payment's referenceNumber.
    const reference = event.id ?? null;
    if (reference) {
      const dup = await prisma.payment.findFirst({
        where: { invoiceId: invoice.id, referenceNumber: reference },
        select: { id: true },
      });
      if (dup) return res.json({ ok: true, alreadyRecorded: true });
    }

    const amount = obj.amount_received ?? obj.amount_total ?? invoice.amountCents;
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: amount,
        method: PaymentMethod.STRIPE,
        referenceNumber: reference,
        notes: `Stripe ${event.type}`,
      },
    });
    const totals = await recomputeInvoiceStatus(invoice.id);

    audit(null, {
      action: 'invoice.payment_recorded',
      resourceType: 'invoice',
      resourceId: invoice.id,
      meta: {
        source: 'stripe',
        paymentId: payment.id,
        stripeEventId: event.id,
        stripeEventType: event.type,
        amountCents: amount,
        newStatus: totals.status,
      },
    }).catch(() => undefined);

    res.json({ ok: true, invoiceId: invoice.id, paymentId: payment.id, status: totals.status });
  } catch (err) {
    next(err);
  }
});

// Plaid webhook receiver — fires for SYNC_UPDATES_AVAILABLE (new
// transactions ready) plus item-level events (login required, error).
// We just trigger a sync; the helper handles cursor advancement +
// dedupe. Sandbox webhooks aren't signed; production ones are JWT-
// signed but we don't verify yet (keys live behind env config).
router.post('/plaid', async (req, res, next) => {
  try {
    const text = req.body instanceof Buffer ? req.body.toString('utf8') : '';
    let evt: { webhook_type?: string; webhook_code?: string; item_id?: string } = {};
    try {
      evt = JSON.parse(text);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    if (!evt.item_id) {
      return res.status(200).json({ ignored: true, reason: 'no item_id' });
    }
    const conn = await prisma.plaidConnection.findUnique({ where: { itemId: evt.item_id } });
    if (!conn) return res.status(200).json({ ignored: true, reason: 'unknown item' });

    if (evt.webhook_type === 'TRANSACTIONS') {
      // SYNC_UPDATES_AVAILABLE / DEFAULT_UPDATE etc. all warrant a re-sync.
      syncPlaidConnection(conn.id).catch(async (err) => {
        await prisma.plaidConnection.update({
          where: { id: conn.id },
          data: { lastError: err?.message ?? 'webhook sync failed' },
        });
      });
      return res.json({ ok: true });
    }
    if (evt.webhook_type === 'ITEM' && evt.webhook_code === 'ERROR') {
      await prisma.plaidConnection.update({
        where: { id: conn.id },
        data: { lastError: 'Item error — re-link required.' },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
