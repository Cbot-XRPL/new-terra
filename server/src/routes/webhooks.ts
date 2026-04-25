import express, { Router } from 'express';
import { ContractStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { mapEnvelopeStatus, verifyConnectSignature } from '../lib/docusign.js';
import { sendContractDecidedEmail } from '../lib/mailer.js';

const router = Router();

// Webhooks bypass our normal JSON middleware so we can verify the HMAC
// against the exact bytes DocuSign signed. Cap at 5 MB to leave headroom
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

export default router;
