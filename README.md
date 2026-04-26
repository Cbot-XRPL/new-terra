# New Terra Construction

Marketing site + employee/customer portal.

- **Frontend** — Vite + React + TypeScript (`client/`)
- **Backend** — Express + TypeScript + Prisma + PostgreSQL (`server/`)
- **Auth** — JWT, password hashing with bcrypt, whitelist via admin-issued invites

## Roles

| Role            | Can see                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `ADMIN`         | Everything; manages whitelist (invite users, enable/disable accounts)        |
| `EMPLOYEE`      | Schedule, message board, project tools (uploads, log entries, messages)      |
| `SUBCONTRACTOR` | Same as employee, scoped to assigned schedules                               |
| `CUSTOMER`      | Their projects, invoices, selections, membership status, messages from staff |

## Quick start

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` → `.env` at the repo root, fill in `DATABASE_URL` and `JWT_SECRET`.
Then in `client/`, create `client/.env` with:

```
VITE_API_URL=http://localhost:4000
```

### 3. Set up the database

You need a running PostgreSQL instance.

```bash
npm run db:migrate   # creates the schema
npm run db:seed      # creates the bootstrap admin (uses SEED_ADMIN_* env vars)
```

### 4. Run

```bash
npm run dev
```

- Client: <http://localhost:5173>
- API:    <http://localhost:4000>

Sign in at `/login` with the seeded admin, then invite users from `/portal/admin`.

## Project structure

```
client/                    React + Vite app
  src/
    auth/                  AuthContext, route guards
    layouts/               Public + portal layouts
    lib/                   API client + formatters
    pages/
      auth/                Login, accept-invite
      portal/              Dashboards + Projects, Invoices, Messages,
                           Message Board pages
      public/              Marketing pages (Home, Contact)
    styles/global.css

server/                    Express API
  prisma/
    schema.prisma          Users, invitations, projects, schedules, invoices,
                           selections, memberships, project images, log entries,
                           message board, messages
    seed.ts                Creates the bootstrap admin
  src/
    routes/
      auth.ts              login, /me, accept-invite, invite lookup
      admin.ts             invitations + user management
      portal.ts            customer + staff overview + staff lookup
      public.ts            unauthenticated contact form (rate-limited)
      projects.ts          projects + nested schedules
      projectImages.ts     project image upload + gallery
      schedules.ts         schedule update / delete
      invoices.ts          admin issue + status transitions
      selections.ts        per-project, customer approval workflow
      memberships.ts       admin assigns tier + renewal
      logEntries.ts        per-project site notes
      board.ts             company message board (staff-only)
      messages.ts          bidirectional staff ↔ customer messaging
    middleware/            requireAuth, requireRole, error handler
    lib/                   JWT, password hashing, mailer, storage
  Dockerfile               Multi-stage build of API + SPA
render.yaml                Render blueprint
```

## Whitelist invite flow

1. Admin POSTs `email` + `role` to `/api/admin/invitations`.
2. Server stores the **hash** of a 32-byte random token; sends an invite link
   (or logs it in dev when SMTP is unset) to `${APP_URL}/accept-invite?token=…`.
3. The recipient opens the link, sets their name + password, and the account is
   created with the role from the invite. The token is single-use and expires in 7 days.

## Deploying

A `render.yaml` blueprint at the repo root provisions the app on
[Render](https://render.com): one Docker web service + a managed Postgres
database + a 5 GB persistent disk for uploads.

```bash
# After connecting the repo on Render and the first deploy completes:
APP_URL=https://<your-render-host>     # Set this in the Render dashboard
SEED_ADMIN_EMAIL=...                   # then run db:seed once via Shell
```

The Dockerfile in `server/` is multi-stage and produces a single image that
serves both the API and the React build (the SPA is served by Express in
`NODE_ENV=production`).

### Image storage

Uploads default to local disk at `server/uploads`. To swap to S3:

1. `npm install @aws-sdk/client-s3 multer-s3`
2. Set `STORAGE_DRIVER=s3` plus `S3_REGION`, `S3_BUCKET`, `S3_PUBLIC_URL`
3. Uncomment the `s3Storage()` branch in `server/src/lib/storage.ts`

### Email

When `SMTP_HOST` is unset (local dev) the mailer logs invitation links and
contact-form submissions to the server console. Set the SMTP vars in prod
to actually send mail. The contact form's recipient is `INQUIRY_TO`.

### Cron jobs

Every cron is opt-in via env var. Leave blank in dev to keep the API
quiet; set in prod. All cron expressions are standard 5-field syntax.

| Env var                   | Default suggested | What it does                                    |
| ------------------------- | ----------------- | ----------------------------------------------- |
| `CONTRACT_REMINDER_CRON`  | `0 9 * * *`       | Re-emails customers about unsigned contracts    |
| `STALE_LEAD_CRON`         | `0 8 * * 1-5`     | Nudges sales reps about quiet leads             |
| `INVOICE_REMINDER_CRON`   | `0 9 * * 1-5`     | SENT → OVERDUE flip + due-soon nudges           |
| `RECURRING_INVOICE_CRON`  | `0 6 * * *`       | Generates DRAFT invoices from recurring tpls    |
| `LABOR_ALERT_CRON`        | `0 * * * *`       | PM email when project labor hits 80% of budget  |
| `SATISFACTION_SURVEY_CRON`| `0 10 * * 1`      | Auto-surveys customers 14d after COMPLETE       |
| `UPLOAD_JANITOR_CRON`     | `0 3 * * *`       | Removes orphaned files from `uploads/`          |

### Production checklist

Before any real customer hits the portal:

1. **Override `SEED_ADMIN_PASSWORD`** in the prod env (the default is in
   plain text in `.env.example`).
2. **Set `JWT_SECRET`** to a fresh 48-byte random string (`node -e
   "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
3. **Set `QB_ENCRYPTION_KEY`** even if you don't use QuickBooks — without
   it, encrypted fields fall back to deriving a key from `JWT_SECRET`,
   which is fine for dev but ties session signing to data encryption.
4. **Set `APP_URL`** to your real public URL — emails (invites, receipts,
   surveys, gallery shares) all interpolate it into links.
5. **Configure SPF + DKIM + DMARC** on your sending domain so customer
   receipts and invoice reminders don't hit spam.
6. **Run `npm run db:seed`** once to create the bootstrap admin, then
   immediately log in and change the password from the profile page.
7. **Pick which crons you actually want**, set them via env, and verify
   the schedule strings parse (the server logs `[cron] X scheduled "Y"`
   on boot).

### Demo seed

`npm run db:seed:demo` (in `server/`) wipes the DB and rebuilds with
sample customers, projects, invoices, photos, etc. Useful for sales
walkthroughs or smoke-testing after a big change. Refuses to run when
`NODE_ENV=production` unless you pass `--force`.

### Operational hygiene

- **Backups** — VM-level snapshots are fine for the typical "I broke it"
  recovery case. For data-corruption-style incidents (someone deletes a
  customer the wrong way), keep a daily `pg_dump` going to a separate
  disk so you can roll a single table back without restoring the whole
  filesystem.
- **Disk usage** — `uploads/` grows unbounded with photos and PDFs.
  Enable `UPLOAD_JANITOR_CRON` so dead files don't pile up; the dry-run
  endpoint at `POST /api/admin/janitor/uploads?dryRun=true` lets you see
  candidates first.
- **Log rotation** — Express + morgan write to stdout. If you're running
  under systemd, journald handles rotation; under PM2, point it at a
  rotating file. Nothing in the app writes its own log files.
