// AI assistant — Anthropic-powered chat that drives the portal.
//
// Each "tool" wraps a real Prisma operation behind a permission gate
// AND a zod schema. When Claude calls a tool with missing/invalid
// input, the zod failure becomes a structured error result that says
// exactly which fields are needed. The system prompt instructs Claude
// to read those errors and ask the user for the missing pieces rather
// than retrying with the same bad input.
//
// Conversations are persisted in AiConversation/AiMessage. Tool-use
// turns are NOT persisted — only the rendered user/assistant text. The
// next time the user resumes the chat, Claude sees the prior text
// context but re-runs whatever tools it needs fresh.

import { Router } from 'express';
import { z, ZodError } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../env.js';
import {
  hasSalesAccess,
  hasProjectManagerCapability,
  hasAccountingAccess,
} from '../lib/permissions.js';
import { Resend } from 'resend';
import crypto from 'node:crypto';

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR));

const MAX_TOOL_HOPS = 8;
const MAX_HISTORY_TURNS = 40; // keep prompt size sane on long chats

const anthropic = env.anthropic.apiKey ? new Anthropic({ apiKey: env.anthropic.apiKey }) : null;
const resend = env.resend.apiKey ? new Resend(env.resend.apiKey) : null;

// The hostname we route inbound replies through. Customize via
// AI_INBOUND_DOMAIN in the env (defaults to "inbound.<from-domain>").
// Replies addressed to r-<threadKey>@<this domain> are matched back to
// the OutboundEmail row by the inbound webhook.
function inboundDomain(): string {
  if (process.env.AI_INBOUND_DOMAIN) return process.env.AI_INBOUND_DOMAIN;
  // Derive from the configured RESEND_FROM, e.g. "no-reply@x.com" → "inbound.x.com"
  const m = env.resend.from.match(/@([^>\s]+)/);
  return m ? `inbound.${m[1]}` : 'inbound.example.com';
}

interface ToolUser {
  id: string;
  role: Role;
  isSales: boolean;
  isProjectManager: boolean;
  isAccounting: boolean;
}

// Each tool: a zod schema for inputs, a permission gate, and a runner
// that gets fully-validated input. Wrapping the run in a structured
// error lets Claude self-correct when fields are missing.
//
// The runner is typed as accepting `any` from the zod parse output so
// every tool's specific schema can be inferred at the call site without
// forcing a generic onto AiTool itself (which collides with putting
// heterogeneous tools in a single array — TS can't unify the generic
// across rows).
interface AiTool {
  name: string;
  description: string;
  inputSchema: Anthropic.Messages.Tool.InputSchema;
  zod: z.ZodTypeAny;
  gate: (user: ToolUser) => boolean;
  run: (input: any, user: ToolUser) => Promise<unknown>;
}

// `tool()` is an identity helper that lets us define each tool with
// inferred zod-input types in the local closure (input is statically
// typed inside `run`) while still returning the array-friendly
// AiTool shape.
function tool<S extends z.ZodTypeAny>(t: {
  name: string;
  description: string;
  inputSchema: Anthropic.Messages.Tool.InputSchema;
  zod: S;
  gate: (user: ToolUser) => boolean;
  run: (input: z.infer<S>, user: ToolUser) => Promise<unknown>;
}): AiTool {
  return t as AiTool;
}

// ─── Tool registry ────────────────────────────────────────────────────

const TOOLS: AiTool[] = [
  // ─── Reads ────────────────────────────────────────────────────────
  tool({
    name: 'list_projects',
    description: 'List the company\'s projects. Returns id, name, status, customer + PM names, address.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional filter: PLANNING, AWAITING_CONTRACT, ACTIVE, ON_HOLD, COMPLETE, CANCELLED' },
        limit: { type: 'number', description: 'Max rows (defaults to 20)' },
      },
    },
    zod: z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    gate: () => true,
    async run(input) {
      const rows = await prisma.project.findMany({
        where: input.status ? { status: input.status as never } : undefined,
        take: input.limit ?? 20,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          projectManager: { select: { id: true, name: true } },
        },
      });
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        address: p.address,
        customer: p.customer,
        projectManager: p.projectManager,
      }));
    },
  }),
  tool({
    name: 'list_leads',
    description: 'List leads in the sales pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'NEW, CONTACTED, QUALIFIED, QUOTE_SENT, WON, LOST, ON_HOLD' },
        limit: { type: 'number' },
      },
    },
    zod: z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    gate: hasSalesAccess,
    async run(input) {
      const rows = await prisma.lead.findMany({
        where: input.status ? { status: input.status as never } : undefined,
        take: input.limit ?? 20,
        orderBy: { updatedAt: 'desc' },
        include: { owner: { select: { id: true, name: true } } },
      });
      return rows.map((l) => ({
        id: l.id, name: l.name, email: l.email, phone: l.phone,
        status: l.status, scope: l.scope,
        estimatedValueCents: l.estimatedValueCents,
        owner: l.owner,
        updatedAt: l.updatedAt.toISOString(),
      }));
    },
  }),
  tool({
    name: 'list_estimates',
    description: 'List recent estimates.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'DRAFT, SENT, VIEWED, ACCEPTED, DECLINED, CONVERTED, EXPIRED, VOID' },
        limit: { type: 'number' },
      },
    },
    zod: z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    gate: hasSalesAccess,
    async run(input) {
      const rows = await prisma.estimate.findMany({
        where: input.status ? { status: input.status as never } : undefined,
        take: input.limit ?? 20,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          lead: { select: { id: true, name: true } },
        },
      });
      return rows.map((e) => ({
        id: e.id, number: e.number, title: e.title, status: e.status,
        totalCents: e.totalCents, customer: e.customer, lead: e.lead,
        createdAt: e.createdAt.toISOString(),
      }));
    },
  }),
  tool({
    name: 'list_invoices',
    description: 'List invoices.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'DRAFT, SENT, VIEWED, OVERDUE, PAID, VOID' },
        limit: { type: 'number' },
      },
    },
    zod: z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    gate: (u) => u.role === Role.ADMIN || hasAccountingAccess(u) || hasProjectManagerCapability(u),
    async run(input) {
      const rows = await prisma.invoice.findMany({
        where: input.status ? { status: input.status as never } : undefined,
        take: input.limit ?? 20,
        orderBy: { issuedAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      });
      return rows.map((i) => ({
        id: i.id, number: i.number, status: i.status,
        amountCents: i.amountCents,
        customer: i.customer, project: i.project,
        issuedAt: i.issuedAt.toISOString(),
        dueAt: i.dueAt?.toISOString() ?? null,
      }));
    },
  }),
  tool({
    name: 'list_users',
    description: 'Look up users by role/name. Use this BEFORE calling create_project to find the customerId, or before send_dm to find the toUserId.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ADMIN, EMPLOYEE, SUBCONTRACTOR, CUSTOMER' },
        nameLike: { type: 'string', description: 'Case-insensitive name substring' },
      },
    },
    zod: z.object({
      role: z.string().optional(),
      nameLike: z.string().optional(),
    }),
    gate: () => true,
    async run(input) {
      return prisma.user.findMany({
        where: {
          isActive: true,
          ...(input.role ? { role: input.role as never } : {}),
          ...(input.nameLike ? { name: { contains: input.nameLike, mode: 'insensitive' } } : {}),
        },
        take: 25,
        select: {
          id: true, name: true, email: true, role: true,
          tradeType: true, isSales: true, isProjectManager: true, isAccounting: true,
        },
      });
    },
  }),
  tool({
    name: 'get_project',
    description: 'Read one project with full detail (schedules, customer, PM, counts).',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
    zod: z.object({ projectId: z.string().min(1) }),
    gate: () => true,
    async run(input) {
      const p = await prisma.project.findUnique({
        where: { id: input.projectId },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          projectManager: { select: { id: true, name: true } },
          schedules: { take: 25, orderBy: { startsAt: 'asc' } },
          _count: { select: { invoices: true, schedules: true, contracts: true } },
        },
      });
      if (!p) return { error: 'Project not found' };
      return p;
    },
  }),

  // ─── Writes ───────────────────────────────────────────────────────
  tool({
    name: 'create_lead',
    description: 'Create a new lead. REQUIRED: name. Strongly recommended: email or phone.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lead\'s full name (required)' },
        email: { type: 'string' },
        phone: { type: 'string' },
        scope: { type: 'string', description: 'Brief description of what they want done' },
        estimatedValueCents: { type: 'number' },
      },
      required: ['name'],
    },
    zod: z.object({
      name: z.string().min(1, 'Lead name is required'),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      scope: z.string().optional(),
      estimatedValueCents: z.number().int().nonnegative().optional(),
    }),
    gate: hasSalesAccess,
    async run(input, user) {
      const lead = await prisma.lead.create({
        data: {
          name: input.name,
          email: input.email?.toLowerCase() ?? null,
          phone: input.phone ?? null,
          scope: input.scope ?? null,
          estimatedValueCents: input.estimatedValueCents ?? null,
          ownerId: user.id,
          createdById: user.id,
        },
      });
      return { id: lead.id, name: lead.name, status: lead.status };
    },
  }),
  tool({
    name: 'update_lead_status',
    description: 'Change a lead\'s pipeline status.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        status: { type: 'string', description: 'NEW, CONTACTED, QUALIFIED, QUOTE_SENT, WON, LOST, ON_HOLD' },
      },
      required: ['leadId', 'status'],
    },
    zod: z.object({
      leadId: z.string().min(1, 'leadId is required'),
      status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST', 'ON_HOLD']),
    }),
    gate: hasSalesAccess,
    async run(input) {
      const updated = await prisma.lead.update({
        where: { id: input.leadId },
        data: { status: input.status },
      });
      return { id: updated.id, status: updated.status };
    },
  }),
  tool({
    name: 'create_project',
    description: 'Create a new project. REQUIRED: customerId, name. Use list_users(role=CUSTOMER) first to find the customerId.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Existing CUSTOMER user id (required)' },
        name: { type: 'string', description: 'Project name (required)' },
        address: { type: 'string' },
        description: { type: 'string' },
        projectManagerId: { type: 'string', description: 'EMPLOYEE id flagged as PM' },
      },
      required: ['customerId', 'name'],
    },
    zod: z.object({
      customerId: z.string().min(1, 'customerId is required — look up the customer with list_users first'),
      name: z.string().min(1, 'Project name is required'),
      address: z.string().optional(),
      description: z.string().optional(),
      projectManagerId: z.string().optional(),
    }),
    gate: (u) =>
      u.role === Role.ADMIN ||
      (u.role === Role.EMPLOYEE && (u.isSales || u.isProjectManager)),
    async run(input) {
      // Confirm the customer + PM (if given) actually exist + are the right role.
      const customer = await prisma.user.findUnique({ where: { id: input.customerId } });
      if (!customer || customer.role !== Role.CUSTOMER) {
        return { error: 'customerId must reference an existing CUSTOMER user. Use list_users(role=CUSTOMER) to find them.' };
      }
      if (input.projectManagerId) {
        const pm = await prisma.user.findUnique({ where: { id: input.projectManagerId } });
        if (!pm || pm.role !== Role.EMPLOYEE || !pm.isProjectManager) {
          return { error: 'projectManagerId must reference an EMPLOYEE flagged as PM.' };
        }
      }
      const project = await prisma.project.create({
        data: {
          customerId: input.customerId,
          name: input.name,
          address: input.address ?? null,
          description: input.description ?? null,
          projectManagerId: input.projectManagerId ?? null,
          status: 'PLANNING',
        },
      });
      return { id: project.id, name: project.name, status: project.status };
    },
  }),
  tool({
    name: 'send_dm',
    description: 'Send a DM from the calling user to another user.',
    inputSchema: {
      type: 'object',
      properties: {
        toUserId: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['toUserId', 'body'],
    },
    zod: z.object({
      toUserId: z.string().min(1, 'toUserId is required — use list_users to find the recipient'),
      body: z.string().min(1, 'Message body is required'),
    }),
    gate: () => true,
    async run(input, user) {
      const target = await prisma.user.findUnique({ where: { id: input.toUserId } });
      if (!target) return { error: 'Target user not found' };
      if (user.role === Role.CUSTOMER && target.role === Role.CUSTOMER) {
        return { error: 'Customer-to-customer messages are not allowed' };
      }
      const msg = await prisma.message.create({
        data: { fromUserId: user.id, toUserId: target.id, body: input.body },
      });
      return { id: msg.id, deliveredTo: target.name };
    },
  }),
  tool({
    name: 'send_email',
    description: 'Send an email on behalf of the calling user. Use this for outbound contact with leads, customers, vendors, etc. The recipient\'s reply is funneled back into the user\'s portal DMs. REQUIRED: to (email), subject, body. Always confirm the body with the user before sending.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        toName: { type: 'string', description: 'Optional recipient display name' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body. Sign off as the company; the user\'s name is included automatically in the From line.' },
      },
      required: ['to', 'subject', 'body'],
    },
    zod: z.object({
      to: z.string().email('to must be a valid email address'),
      toName: z.string().optional(),
      subject: z.string().min(1, 'subject is required').max(200),
      body: z.string().min(1, 'body is required').max(10_000),
    }),
    gate: () => true,
    async run(input, user) {
      if (!resend) {
        return { error: 'Email is not configured. Set RESEND_API_KEY in the server env.' };
      }
      const me = await prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true, email: true },
      });
      if (!me) return { error: 'Sender lookup failed' };
      // Random token in the reply-to so we can match an inbound bounce
      // back to this row. 24 hex chars → ~96 bits of entropy, plenty.
      const threadKey = crypto.randomBytes(12).toString('hex');
      const replyTo = `r-${threadKey}@${inboundDomain()}`;
      const fromName = me.name;
      const fromAddr = env.resend.from.match(/<([^>]+)>/)?.[1] ?? env.resend.from;
      const fromHeader = `${fromName} via New Terra Construction <${fromAddr}>`;

      const { error } = await resend.emails.send({
        from: fromHeader,
        to: input.to,
        replyTo,
        subject: input.subject,
        text: `${input.body}\n\n— ${me.name}\nNew Terra Construction\n(Replies to this email come back as a portal DM.)`,
      });
      if (error) {
        return { error: `Resend send failed: ${error.message ?? 'unknown'}` };
      }

      const stored = await prisma.outboundEmail.create({
        data: {
          fromUserId: user.id,
          toEmail: input.to.toLowerCase(),
          toName: input.toName ?? null,
          subject: input.subject,
          body: input.body,
          threadKey,
        },
        select: { id: true, sentAt: true },
      });
      return {
        id: stored.id,
        sentAt: stored.sentAt,
        replyTo,
        note: 'Sent. Replies come back as DMs to you in the portal.',
      };
    },
  }),
  tool({
    name: 'create_schedule',
    description: 'Schedule work on a project. Times in ISO-8601. Can have multiple assignees.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        startsAt: { type: 'string' },
        endsAt: { type: 'string' },
        notes: { type: 'string' },
        assigneeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId', 'title', 'startsAt', 'endsAt'],
    },
    zod: z.object({
      projectId: z.string().min(1, 'projectId is required'),
      title: z.string().min(1, 'Title is required'),
      startsAt: z.string().datetime({ message: 'startsAt must be a valid ISO-8601 datetime' }),
      endsAt: z.string().datetime({ message: 'endsAt must be a valid ISO-8601 datetime' }),
      notes: z.string().optional(),
      assigneeIds: z.array(z.string()).optional(),
    }),
    gate: (u) => u.role === Role.ADMIN || (u.role === Role.EMPLOYEE && (u.isSales || u.isProjectManager)),
    async run(input) {
      const sched = await prisma.schedule.create({
        data: {
          projectId: input.projectId,
          title: input.title,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          notes: input.notes ?? null,
        },
      });
      if (input.assigneeIds && input.assigneeIds.length > 0) {
        await prisma.scheduleAssignee.createMany({
          data: input.assigneeIds.map((userId) => ({ scheduleId: sched.id, userId })),
        });
      }
      return { id: sched.id, title: sched.title };
    },
  }),
];

const SYSTEM_PROMPT = `You are the AI assistant inside the New Terra Construction portal — a project, sales, and finance system for a residential general contractor in Atlanta GA.

You help admins, employees, sales reps, project managers, and subcontractors get work done by calling tools that read or modify the system.

## Critical rules

1. **Validate before acting.** Before calling a write tool (create_*, update_*, send_dm, etc.), check that you have every required field listed in the tool description. If anything is missing or ambiguous, ASK THE USER first — never guess values.

2. **Tool errors are guidance, not failure.** If a tool returns \`{ error: "...", missing: [...] }\` or a zod validation error, read it carefully and ask the user for the listed missing fields. Do not retry the same tool with the same bad input.

3. **Look things up before you create them.** To create a project, you need a customerId — look it up with \`list_users(role=CUSTOMER, nameLike=...)\` first, *then* call \`create_project\`. Same for projectManagerId and DM recipients.

4. **Confirm destructive or significant actions** before calling them. e.g. "I'll create a project called Smith Deck for Cody Ricketts (cust_abc123) — confirm?" then call the tool only after the user says yes.

## Style

- Be concise. Short paragraphs and bullets.
- Construction-industry vocabulary is fine (PM, sub, draws, change orders, punch list).
- After a successful mutation, return the new id/number plus one short sentence — don't dump JSON.
- If a search returns zero, say so plainly and suggest a refinement.
- Never invent IDs, numbers, or dates that didn't come from a tool result.

Current date: ${new Date().toISOString().slice(0, 10)}.`;

// ─── Conversation CRUD ────────────────────────────────────────────────

router.get('/conversations', async (req, res, next) => {
  try {
    const rows = await prisma.aiConversation.findMany({
      where: { userId: req.user!.sub },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    res.json({ conversations: rows });
  } catch (err) { next(err); }
});

router.post('/conversations', async (req, res, next) => {
  try {
    const conv = await prisma.aiConversation.create({
      data: { userId: req.user!.sub, title: 'New chat' },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    res.status(201).json({ conversation: conv });
  } catch (err) { next(err); }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await prisma.aiConversation.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv || conv.userId !== req.user!.sub) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ conversation: conv });
  } catch (err) { next(err); }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const body = z.object({ title: z.string().min(1).max(120) }).parse(req.body);
    const conv = await prisma.aiConversation.findUnique({ where: { id: req.params.id } });
    if (!conv || conv.userId !== req.user!.sub) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const updated = await prisma.aiConversation.update({
      where: { id: req.params.id },
      data: { title: body.title },
    });
    res.json({ conversation: updated });
  } catch (err) { next(err); }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await prisma.aiConversation.findUnique({ where: { id: req.params.id } });
    if (!conv || conv.userId !== req.user!.sub) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    await prisma.aiConversation.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ─── Chat (with optional persistence) ─────────────────────────────────

const chatSchema = z.object({
  // Either pass conversationId to load + persist, or omit for ephemeral.
  conversationId: z.string().optional(),
  // The full visible history. Tool turns aren't included here.
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(20_000),
    }),
  ).min(1),
  // Optional images attached to the latest user turn. Base64 data only
  // (no data: prefix); the server stitches them into the message before
  // forwarding to Anthropic. Capped per-call so payloads stay sane.
  images: z.array(z.object({
    mediaType: z.string().regex(/^image\/(png|jpeg|gif|webp)$/, 'Unsupported image type'),
    data: z.string().min(1).max(15_000_000), // ~11MB base64-encoded
  })).max(8).optional(),
});

router.post('/chat', async (req, res, next) => {
  try {
    if (!anthropic) {
      return res.status(503).json({
        error: 'AI assistant is not configured. Set ANTHROPIC_API_KEY in the server env.',
      });
    }
    const { messages, conversationId, images } = chatSchema.parse(req.body);
    const me = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, role: true, isSales: true, isProjectManager: true, isAccounting: true },
    });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    // Validate ownership of conversationId if provided.
    if (conversationId) {
      const owns = await prisma.aiConversation.findFirst({
        where: { id: conversationId, userId: me.id },
        select: { id: true },
      });
      if (!owns) return res.status(404).json({ error: 'Conversation not found' });
    }

    const allowedTools = TOOLS.filter((t) => t.gate(me));

    // Trim history so the prompt stays bounded — keep the most recent
    // MAX_HISTORY_TURNS user/assistant turns.
    const trimmed = messages.slice(-MAX_HISTORY_TURNS);
    const anthropicMessages: Anthropic.Messages.MessageParam[] = trimmed.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // Stitch attached images onto the latest user message. Anthropic's
    // image content blocks live alongside text in a content array.
    if (images && images.length > 0) {
      const lastIdx = anthropicMessages.length - 1;
      const last = anthropicMessages[lastIdx];
      if (last && last.role === 'user' && typeof last.content === 'string') {
        anthropicMessages[lastIdx] = {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: img.data,
              },
            })),
            { type: 'text' as const, text: last.content },
          ],
        };
      }
    }

    let hops = 0;
    let finalText = '';
    let totalIn = 0;
    let totalOut = 0;
    while (hops++ < MAX_TOOL_HOPS) {
      const response = await anthropic.messages.create({
        model: env.anthropic.model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: allowedTools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        messages: anthropicMessages,
      });
      totalIn += response.usage.input_tokens;
      totalOut += response.usage.output_tokens;

      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUses.length === 0 || response.stop_reason !== 'tool_use') {
        finalText = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim() || '(no response)';
        break;
      }

      anthropicMessages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const t of toolUses) {
        const tool = TOOLS.find((x) => x.name === t.name);
        if (!tool || !tool.gate(me)) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify({ error: 'Forbidden or unknown tool' }),
            is_error: true,
          });
          continue;
        }
        // Validate input via zod first — turn parse failures into a
        // structured "missing/invalid fields" message Claude can read.
        const parsed = tool.zod.safeParse(t.input);
        if (!parsed.success) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify({
              error: 'Invalid or missing fields',
              issues: (parsed.error as ZodError).issues.map((iss) => ({
                field: iss.path.join('.') || '(root)',
                message: iss.message,
              })),
            }),
            is_error: true,
          });
          continue;
        }
        try {
          const out = await tool.run(parsed.data, me);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify(out),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify({
              error: err instanceof Error ? err.message : 'Tool failed',
            }),
            is_error: true,
          });
        }
      }
      anthropicMessages.push({ role: 'user', content: toolResults });
    }

    if (!finalText) {
      finalText = `(Stopped after ${MAX_TOOL_HOPS} tool hops without a final answer — try a simpler request.)`;
    }

    // Persist if a conversationId was provided. We save the *latest*
    // user message + the assistant reply only — the trimmed history
    // already covers the rest from prior turns.
    if (conversationId) {
      const latestUser = messages[messages.length - 1];
      // Auto-title the conversation from the first user message.
      const conv = await prisma.aiConversation.findUnique({
        where: { id: conversationId },
        include: { _count: { select: { messages: true } } },
      });
      const isFirstTurn = conv?._count.messages === 0;
      const title = isFirstTurn && latestUser
        ? latestUser.content.slice(0, 80).trim()
        : undefined;

      await prisma.$transaction(async (tx) => {
        if (latestUser && latestUser.role === 'user') {
          await tx.aiMessage.create({
            data: {
              conversationId,
              role: 'user',
              content: latestUser.content,
            },
          });
        }
        await tx.aiMessage.create({
          data: { conversationId, role: 'assistant', content: finalText },
        });
        await tx.aiConversation.update({
          where: { id: conversationId },
          data: title ? { title, updatedAt: new Date() } : { updatedAt: new Date() },
        });
      });
    }

    res.json({
      reply: finalText,
      inputTokens: totalIn,
      outputTokens: totalOut,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
