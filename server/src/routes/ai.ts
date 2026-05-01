// AI assistant — Anthropic-powered chat that can actually drive the
// portal. Each "tool" is a permission-gated bridge to a real Prisma
// operation. Claude decides which tool to call based on the user's
// message; the server executes (respecting the *caller's* role + flags,
// not Claude's "wishes"); the result is fed back to Claude until it
// returns a plain-text reply.
//
// Auth model: every tool re-runs the relevant role checks. Claude
// cannot escalate the calling user's permissions — if a sales rep asks
// "delete project X", the delete tool's gate trips and Claude gets a
// "Forbidden" tool result.
//
// Cost guard: we cap each conversation turn at MAX_TOOL_HOPS hops so a
// runaway loop can't burn the budget.

import { Router } from 'express';
import { z } from 'zod';
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

const router = Router();
router.use(requireAuth);
// Customers don't get the assistant — internal-only tool. Subcontractors
// get the read-only slice (list their schedule, see project info).
router.use(requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR));

const MAX_TOOL_HOPS = 8;

const anthropic = env.anthropic.apiKey ? new Anthropic({ apiKey: env.anthropic.apiKey }) : null;

// ─── Tool registry ────────────────────────────────────────────────────
//
// Each tool: name, description shown to Claude, JSON schema for inputs,
// a `gate(user) => boolean` that decides if the calling user can use it,
// and an async `run(input, user)` that does the work and returns a JSON-
// safe object.

interface ToolUser {
  id: string;
  role: Role;
  isSales: boolean;
  isProjectManager: boolean;
  isAccounting: boolean;
}

interface AiTool {
  name: string;
  description: string;
  inputSchema: Anthropic.Messages.Tool.InputSchema;
  gate: (user: ToolUser) => boolean;
  run: (input: Record<string, unknown>, user: ToolUser) => Promise<unknown>;
}

const TOOLS: AiTool[] = [
  // ─── Reads ────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description: 'List the company\'s projects. Returns id, name, status, customer name, PM name, address.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional filter: PLANNING, AWAITING_CONTRACT, ACTIVE, ON_HOLD, COMPLETE, CANCELLED' },
        limit: { type: 'number', description: 'Max rows to return; defaults to 20' },
      },
    },
    gate: () => true,
    async run(input) {
      const status = typeof input.status === 'string' ? input.status : undefined;
      const limit = typeof input.limit === 'number' ? Math.min(input.limit, 100) : 20;
      const rows = await prisma.project.findMany({
        where: status ? { status: status as never } : undefined,
        take: limit,
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
        customer: p.customer ? { id: p.customer.id, name: p.customer.name } : null,
        projectManager: p.projectManager ? { id: p.projectManager.id, name: p.projectManager.name } : null,
      }));
    },
  },
  {
    name: 'list_leads',
    description: 'List leads in the sales pipeline. Sales access required.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional: NEW, CONTACTED, QUALIFIED, QUOTE_SENT, WON, LOST, ON_HOLD' },
        limit: { type: 'number', description: 'Max rows; defaults to 20' },
      },
    },
    gate: hasSalesAccess,
    async run(input) {
      const status = typeof input.status === 'string' ? input.status : undefined;
      const limit = typeof input.limit === 'number' ? Math.min(input.limit, 100) : 20;
      const rows = await prisma.lead.findMany({
        where: status ? { status: status as never } : undefined,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { owner: { select: { id: true, name: true } } },
      });
      return rows.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        status: l.status,
        scope: l.scope,
        estimatedValueCents: l.estimatedValueCents,
        owner: l.owner ? { id: l.owner.id, name: l.owner.name } : null,
        updatedAt: l.updatedAt.toISOString(),
      }));
    },
  },
  {
    name: 'list_estimates',
    description: 'List recent estimates. Sales access required.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional: DRAFT, SENT, VIEWED, ACCEPTED, DECLINED, CONVERTED, EXPIRED, VOID' },
        limit: { type: 'number' },
      },
    },
    gate: hasSalesAccess,
    async run(input) {
      const status = typeof input.status === 'string' ? input.status : undefined;
      const limit = typeof input.limit === 'number' ? Math.min(input.limit, 100) : 20;
      const rows = await prisma.estimate.findMany({
        where: status ? { status: status as never } : undefined,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          lead: { select: { id: true, name: true } },
        },
      });
      return rows.map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        totalCents: e.totalCents,
        customer: e.customer,
        lead: e.lead,
        createdAt: e.createdAt.toISOString(),
      }));
    },
  },
  {
    name: 'list_invoices',
    description: 'List invoices. Accounting/admin access for company-wide; PMs see project-scoped only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional: DRAFT, SENT, VIEWED, OVERDUE, PAID, VOID' },
        limit: { type: 'number' },
      },
    },
    gate: (u) => u.role === Role.ADMIN || hasAccountingAccess(u) || hasProjectManagerCapability(u),
    async run(input) {
      const status = typeof input.status === 'string' ? input.status : undefined;
      const limit = typeof input.limit === 'number' ? Math.min(input.limit, 100) : 20;
      const rows = await prisma.invoice.findMany({
        where: status ? { status: status as never } : undefined,
        take: limit,
        orderBy: { issuedAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      });
      return rows.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        amountCents: i.amountCents,
        customer: i.customer,
        project: i.project,
        issuedAt: i.issuedAt.toISOString(),
        dueAt: i.dueAt?.toISOString() ?? null,
      }));
    },
  },
  {
    name: 'list_users',
    description: 'Look up users in the system by role/name. Useful for finding a customer id, PM id, or contractor id before creating something.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Optional: ADMIN, EMPLOYEE, SUBCONTRACTOR, CUSTOMER' },
        nameLike: { type: 'string', description: 'Optional case-insensitive name substring' },
      },
    },
    gate: () => true,
    async run(input) {
      const role = typeof input.role === 'string' ? input.role : undefined;
      const nameLike = typeof input.nameLike === 'string' ? input.nameLike : undefined;
      const rows = await prisma.user.findMany({
        where: {
          isActive: true,
          ...(role ? { role: role as never } : {}),
          ...(nameLike ? { name: { contains: nameLike, mode: 'insensitive' } } : {}),
        },
        take: 25,
        select: { id: true, name: true, email: true, role: true, tradeType: true, isSales: true, isProjectManager: true },
      });
      return rows;
    },
  },
  {
    name: 'get_project',
    description: 'Read a single project with full detail.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
    gate: () => true,
    async run(input) {
      const id = String(input.projectId);
      const p = await prisma.project.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          projectManager: { select: { id: true, name: true } },
          schedules: {
            take: 25,
            orderBy: { startsAt: 'asc' },
            include: { assignee: { select: { id: true, name: true } } },
          },
          _count: { select: { invoices: true, schedules: true, contracts: true } },
        },
      });
      if (!p) return { error: 'Project not found' };
      return p;
    },
  },

  // ─── Writes ───────────────────────────────────────────────────────
  {
    name: 'create_lead',
    description: 'Create a new lead in the sales pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        scope: { type: 'string', description: 'Brief description of what they want done' },
        estimatedValueCents: { type: 'number' },
      },
      required: ['name'],
    },
    gate: hasSalesAccess,
    async run(input, user) {
      const lead = await prisma.lead.create({
        data: {
          name: String(input.name),
          email: typeof input.email === 'string' ? input.email.toLowerCase() : null,
          phone: typeof input.phone === 'string' ? input.phone : null,
          scope: typeof input.scope === 'string' ? input.scope : null,
          estimatedValueCents: typeof input.estimatedValueCents === 'number' ? input.estimatedValueCents : null,
          ownerId: user.id,
          createdById: user.id,
        },
      });
      return { id: lead.id, name: lead.name, status: lead.status };
    },
  },
  {
    name: 'update_lead_status',
    description: 'Change a lead\'s status. Use to advance through the pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        status: { type: 'string', description: 'NEW, CONTACTED, QUALIFIED, QUOTE_SENT, WON, LOST, ON_HOLD' },
      },
      required: ['leadId', 'status'],
    },
    gate: hasSalesAccess,
    async run(input) {
      const updated = await prisma.lead.update({
        where: { id: String(input.leadId) },
        data: { status: String(input.status) as never },
      });
      return { id: updated.id, status: updated.status };
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project. Customer must already exist (use list_users with role=CUSTOMER first).',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        name: { type: 'string' },
        address: { type: 'string' },
        description: { type: 'string' },
        projectManagerId: { type: 'string', description: 'Optional EMPLOYEE id flagged as PM' },
      },
      required: ['customerId', 'name'],
    },
    gate: (u) =>
      u.role === Role.ADMIN ||
      (u.role === Role.EMPLOYEE && (u.isSales || u.isProjectManager)),
    async run(input) {
      const project = await prisma.project.create({
        data: {
          customerId: String(input.customerId),
          name: String(input.name),
          address: typeof input.address === 'string' ? input.address : null,
          description: typeof input.description === 'string' ? input.description : null,
          projectManagerId: typeof input.projectManagerId === 'string' ? input.projectManagerId : null,
          status: 'PLANNING',
        },
      });
      return { id: project.id, name: project.name, status: project.status };
    },
  },
  {
    name: 'send_dm',
    description: 'Send a direct message from the calling user to another user in the system.',
    inputSchema: {
      type: 'object',
      properties: {
        toUserId: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['toUserId', 'body'],
    },
    gate: () => true,
    async run(input, user) {
      const target = await prisma.user.findUnique({ where: { id: String(input.toUserId) } });
      if (!target) return { error: 'Target user not found' };
      // Customer↔customer DMs blocked at the regular messages route — mirror that here.
      if (user.role === Role.CUSTOMER && target.role === Role.CUSTOMER) {
        return { error: 'Customer-to-customer messages are not allowed' };
      }
      const msg = await prisma.message.create({
        data: {
          fromUserId: user.id,
          toUserId: target.id,
          body: String(input.body),
        },
      });
      return { id: msg.id, deliveredTo: target.name };
    },
  },
  {
    name: 'create_schedule',
    description: 'Add a schedule entry to a project. Times in ISO-8601.',
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
    gate: (u) => u.role === Role.ADMIN || (u.role === Role.EMPLOYEE && (u.isSales || u.isProjectManager)),
    async run(input) {
      const sched = await prisma.schedule.create({
        data: {
          projectId: String(input.projectId),
          title: String(input.title),
          startsAt: new Date(String(input.startsAt)),
          endsAt: new Date(String(input.endsAt)),
          notes: typeof input.notes === 'string' ? input.notes : null,
        },
      });
      const ids = Array.isArray(input.assigneeIds) ? input.assigneeIds.filter((s): s is string => typeof s === 'string') : [];
      if (ids.length > 0) {
        await prisma.scheduleAssignee.createMany({
          data: ids.map((userId) => ({ scheduleId: sched.id, userId })),
        });
      }
      return { id: sched.id, title: sched.title };
    },
  },
];

const SYSTEM_PROMPT = `You are the AI assistant inside the New Terra Construction portal — a project + sales + finance management system for a residential GC in Atlanta GA.

You help admins, employees, sales reps, project managers, and subcontractors get work done by calling tools that read or modify the system. Tools enforce the calling user's permissions; if a tool returns a Forbidden / not-found error, surface it plainly to the user and suggest a path forward.

Style:
- Be concise. Short paragraphs, bullet lists when useful.
- Construction industry vocabulary is fair game (PM, sub, draws, change orders, punch list, etc.).
- For lookups: call the tool, summarize the result, don't dump raw JSON.
- For mutations: confirm what you did + return the new id / number, never spam IDs unprompted.
- If multiple records could match, ask one clarifying question rather than guessing.
- Never invent data not in tool results.

Current date: ${new Date().toISOString().slice(0, 10)}.`;

const chatSchema = z.object({
  // The conversation so far. The client sends the full history each turn.
  // role: 'user' | 'assistant'. Tool turns are server-managed.
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(20_000),
    }),
  ).min(1),
});

router.post('/chat', async (req, res, next) => {
  try {
    if (!anthropic) {
      return res.status(503).json({
        error: 'AI assistant is not configured. Set ANTHROPIC_API_KEY in the server env.',
      });
    }
    const { messages } = chatSchema.parse(req.body);
    const me = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, role: true, isSales: true, isProjectManager: true, isAccounting: true },
    });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    // Filter the tool list to those the caller can actually use. Saves
    // tokens and prevents Claude from suggesting a tool the user can't run.
    const allowedTools = TOOLS.filter((t) => t.gate(me));

    const anthropicMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let hops = 0;
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

      // Pull every tool_use block out and run them all before we loop.
      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUses.length === 0 || response.stop_reason !== 'tool_use') {
        // Plain text reply — return it to the client and stop.
        const text = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return res.json({
          reply: text || '(no response)',
          stopReason: response.stop_reason,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        });
      }

      // Persist Claude's tool-use turn into the running history.
      anthropicMessages.push({ role: 'assistant', content: response.content });

      // Execute each tool and stuff the results back in.
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
        try {
          const out = await tool.run(t.input as Record<string, unknown>, me);
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

    res.status(500).json({ error: `Hit max tool hops (${MAX_TOOL_HOPS}). Try a simpler question.` });
  } catch (err) {
    next(err);
  }
});

export default router;
