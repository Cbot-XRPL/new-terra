// Append-only audit log helper. Call from anywhere we mutate sensitive
// state — role changes, user disables, contract status flips, expense
// deletes, QB connect/disconnect, etc.
//
// Failures here are swallowed. We do not want a logging bug to fail the
// underlying operation; the audit is best-effort by design.

import { prisma } from '../db.js';
import type { Request } from 'express';

interface RecordInput {
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  meta?: Record<string, unknown> | null;
  // Optional explicit actor; otherwise derived from req.user.
  actorId?: string | null;
  actorRole?: string | null;
}

export async function audit(
  req: Request | null,
  input: RecordInput,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        meta: (input.meta as object) ?? undefined,
        actorId: input.actorId ?? req?.user?.sub ?? null,
        actorRole: input.actorRole ?? req?.user?.role ?? null,
        ip: req?.ip ?? null,
      },
    });
  } catch (err) {
    console.warn('[audit] failed to record event', input.action, err);
  }
}
