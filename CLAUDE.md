# New Terra Construction Portal

Customer + employee portal for a residential GC (Atlanta, GA). Monorepo:
React+Vite client, Express+Prisma server, PostgreSQL.

## Repo layout

- `client/` — React 18 + Vite + TypeScript SPA
- `server/` — Express + Prisma + TypeScript API
- `server/prisma/schema.prisma` — single source of truth for the DB
- `.env` lives at the **repo root** (not in `server/`); a custom loader in
  `server/src/env.ts` walks up to find it. Prisma CLI does NOT walk up,
  so a symlink is needed for `prisma generate` / `db push`:
  ```bash
  ln -sf ../.env server/.env
  ```

## Roles

- `ADMIN` — everything
- `EMPLOYEE` with capability flags: `isSales`, `isProjectManager`, `isAccounting`
- `SUBCONTRACTOR` — sees only projects/schedules they're assigned to
- `PHOTOGRAPHER` — narrow scope: company calendar (read-only), messages,
  request pay, gallery for photo/video uploads
- `CUSTOMER` — sees only their own projects/invoices/estimates/contracts

Capability checks live in `server/src/lib/permissions.ts`. Use those helpers
(`hasSalesAccess`, `hasAccountingAccess`, `hasProjectManagerCapability`,
`canManageProject`, `isStaffRole`, `canReadCalendar`, `canSubmitExpense`)
rather than re-implementing role math inline.

`canManageProject` grants project write access to **any** PM-flagged employee
(not just the assigned PM) so unassigned / shared-PM workflows work.

## Auth

JWT via `requireAuth` middleware. Token contains `sub` (userId), `role`,
`email`, and `tv` (tokenVersion). The middleware re-queries the user on
every request to validate `tokenVersion` — that's how we revoke without a
session table (password reset, role change, sign-out-everywhere all bump
`tokenVersion`).

Federated sign-in: `GET /api/auth/google/start` → `/callback` → bounces back
to client at `/login#google_token=...`. `loginWithToken(jwt)` on
`AuthContext` finishes the flow.

## Deploy (VM)

The VM runs Ubuntu + PM2 + systemd, app at app.newterraconstruction.com.

Standard one-liner:

```bash
git pull && (cd server && npm run build) && (cd client && npm run build) && pm2 restart all
```

When the Prisma schema changes, prepend the regenerate steps:

```bash
cd ~/new-terra/server && npx prisma generate && npx prisma db push && npm run build && cd ../client && npm run build && pm2 restart all
```

Common deploy gotcha: if `npm run build` fails on Prisma type errors, the
client may have rebuilt with the new code while the server is still on the
old build — UI shows new buttons that 403 on click. Always check both
builds completed before debugging permission issues.

## Conventions

- **No new docs** — never create `*.md` files unless the user asks.
  This file is the exception.
- **No comment-noise** — only add comments where the *why* is non-obvious.
  Don't restate what the code does.
- **No premature abstraction** — three similar lines beat a helper.
- **Edit, don't write** — prefer Edit over Write on existing files.
- **Single project-scope helper pattern**: project-scoped reads/writes
  (images, docs, logs, selections) all use a local `loadProjectAccessible`
  that handles CUSTOMER (own only), SUBCONTRACTOR/PHOTOGRAPHER (assigned
  via `Schedule` only), and staff (full access).
- **AI tool scoping**: every tool in `server/src/routes/ai.ts` must mirror
  the REST handler's gate + where-clause. Use `projectScopeFor(user)` for
  project-scoped tools.
- **Webhooks** require shared-secret headers (Resend inbound, Plaid). When
  adding new ones, follow the same pattern: env var holds secret, header
  comparison short-circuits unauthenticated callers.

## Style

- Native theme is GitHub-dark-style (`#0d1117` bg, `#58a6ff` accent).
- Calendar pills use `var(--accent)` — overridden on continuation days
  (`.is-continuation`) with reduced opacity for multi-day events.
- Composer alignment: explicit `margin: 0` on textarea is required —
  the global `textarea { margin-bottom: 1rem }` rule otherwise breaks
  flex/grid centering of paperclip + send buttons.

## What NOT to touch without thinking twice

- `tokenVersion` flow — silently breaks every active session if you change
  the JWT shape.
- `redactForCustomer` in `server/src/routes/projects.ts` — strips internal
  fields (`budgetCents`, internal notes) for customer-facing responses.
  Adding new internal fields means updating the redactor.
- `MAX_TOOL_HOPS` / `MAX_HISTORY_TURNS` in `server/src/routes/ai.ts` —
  these cap Anthropic API spend. Lowering is fine; raising costs money.

## Useful files when picking up new work

- `server/src/lib/permissions.ts` — every role gate
- `server/src/routes/ai.ts` — AI tool registry, scoping helpers, system prompt
- `client/src/auth/RequireAuth.tsx` — route-level auth + flag gates
- `client/src/layouts/PortalLayout.tsx` — sidebar visibility logic
- `client/src/styles/global.css` — single CSS file for the whole app
