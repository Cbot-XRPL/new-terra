# VM Deploy

Production runs natively on a Linux VM — no Docker, no Render. Local dev uses
an embedded Postgres bundled in the npm install (see `npm run db:setup`); the
VM uses a real Postgres install.

## One-time VM setup (Ubuntu 22.04+ / Debian 12+)

```bash
# Node 20 + build tools
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# PostgreSQL 17
sudo apt-get install -y postgresql postgresql-contrib

# Create the app DB + role
sudo -u postgres psql <<'SQL'
CREATE USER nt_app WITH PASSWORD 'CHANGE_ME_STRONG_PW';
CREATE DATABASE new_terra OWNER nt_app;
SQL
```

## Deploy

```bash
# As the app user (e.g. `newterra`)
git clone <repo-url> /srv/new-terra
cd /srv/new-terra
npm ci
npm run build
```

Create `/srv/new-terra/.env` (do **not** commit this) with prod values:

```
DATABASE_URL=postgresql://nt_app:CHANGE_ME_STRONG_PW@localhost:5432/new_terra?schema=public
PORT=4000
NODE_ENV=production

JWT_SECRET=<48 random bytes hex; see README>
JWT_EXPIRES_IN=7d
APP_URL=https://your-public-host

SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=<strong pw — change after first login>
SEED_ADMIN_NAME=Site Admin

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="New Terra Construction <no-reply@yourdomain>"
INQUIRY_TO=sales@yourdomain

# Crons — see README for the full list
CONTRACT_REMINDER_CRON=0 9 * * *
INVOICE_REMINDER_CRON=0 9 * * 1-5
UPLOAD_JANITOR_CRON=0 3 * * *
```

Apply migrations and create the bootstrap admin:

```bash
cd /srv/new-terra/server
npx prisma migrate deploy
npm run db:seed
```

## systemd unit

`/etc/systemd/system/new-terra.service`:

```ini
[Unit]
Description=New Terra API + SPA
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=newterra
WorkingDirectory=/srv/new-terra/server
EnvironmentFile=/srv/new-terra/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now new-terra
sudo systemctl status new-terra
journalctl -u new-terra -f   # tail logs
```

## Reverse proxy (nginx)

The Express server serves both `/api/*` and the React SPA on port 4000. Front
it with nginx for TLS:

```nginx
server {
    listen 443 ssl http2;
    server_name your-public-host;

    # certbot --nginx fills these in
    # ssl_certificate ...
    # ssl_certificate_key ...

    client_max_body_size 50M;   # photo uploads

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Updates

```bash
cd /srv/new-terra
git pull
npm ci
npm run build
cd server && npx prisma migrate deploy
sudo systemctl restart new-terra
```

## Backups

VM snapshot covers the "I broke it" case. For data-corruption recovery, run a
nightly `pg_dump` to a separate disk:

```bash
# /etc/cron.daily/new-terra-backup
sudo -u postgres pg_dump new_terra | gzip > /var/backups/new-terra-$(date +\%F).sql.gz
find /var/backups -name 'new-terra-*.sql.gz' -mtime +30 -delete
```

Uploads in `server/uploads/` should be on the VM's main disk and included in
your snapshot policy. If you outgrow a single disk, swap the storage driver to
S3 (see README).
