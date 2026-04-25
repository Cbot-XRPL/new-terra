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

## What's still on the list

- Realtime messaging (currently 10–15s polling)
- Invoice PDF generation + Stripe / ACH payment links
- Project image thumbnails (currently full-size with lazy loading)
- Staff-side calendar view (currently a list)
- Cloudflare Turnstile or hCaptcha on the public contact form
