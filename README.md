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
    lib/                   API client
    pages/
      auth/                Login, accept-invite
      portal/              Customer / Staff / Admin dashboards
      public/              Marketing pages (Home, Contact)
    styles/global.css

server/                    Express API
  prisma/
    schema.prisma          Users, invitations, projects, invoices, selections,
                           memberships, schedules, project images, log entries,
                           message board, client messages
    seed.ts                Creates the bootstrap admin
  src/
    routes/
      auth.ts              login, /me, accept-invite, invite lookup
      admin.ts             invitations CRUD, user management
      portal.ts            customer + staff overview endpoints
    middleware/            requireAuth, requireRole, error handler
    lib/                   JWT, password hashing, mailer
```

## Whitelist invite flow

1. Admin POSTs `email` + `role` to `/api/admin/invitations`.
2. Server stores the **hash** of a 32-byte random token; sends an invite link
   (or logs it in dev when SMTP is unset) to `${APP_URL}/accept-invite?token=…`.
3. The recipient opens the link, sets their name + password, and the account is
   created with the role from the invite. The token is single-use and expires in 7 days.

## What's next

This commit is the scaffold. Features to build out:

- Project + schedule CRUD endpoints (admin/staff)
- Image upload endpoint (multer is already a dependency; wire to S3 or local disk)
- Invoice creation + PDF download
- Customer ↔ staff messaging (real-time via SSE or polling)
- Public contact form → backend (with rate limiting + spam protection)
- Production deployment config (Docker / Render / etc.)
