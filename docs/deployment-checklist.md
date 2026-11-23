# Deployment checklist

Everything to do when putting the Sarvodaya API on a real server for the first time, and
what to re-check on every later release. Nothing here is done by the code: it is the list
the person deploying works through.

## 1. Before the first deploy

- [ ] **A server.** Any Node.js 20+ host that can reach PostgreSQL and Redis. The API has
      no filesystem state, so it can run behind a load balancer or on a platform such as
      Render, Railway, Fly.io or ECS.
- [ ] **PostgreSQL 16** with a dedicated database and user. Keep the connection string
      private; append `?schema=public&connection_limit=10` if the pooler needs it.
- [ ] **Redis 7** (or a managed equivalent). It holds OTPs and rate-limit counters only;
      losing it logs people out of the OTP flow, nothing else.
- [ ] **The `pg_trgm` extension.** The search indexes need it. On most managed databases
      an admin can run `CREATE EXTENSION IF NOT EXISTS pg_trgm;`. If the deploy account
      cannot, the migration prints a notice and skips the trigram indexes: search still
      works, just slower on a large catalogue. Install the extension and re-run the
      migration to get them.

## 2. Build

```bash
npm ci                       # or npm install on the very first deploy
npx prisma migrate deploy    # applies every migration, safe to re-run
npm run seed                 # first deploy only: admin, sample data, pricing
npm run build
npm start
```

- `npm run seed` is idempotent: it never duplicates the admin, categories or products and
  never overwrites a price or stock level the owner has changed. It is safe to leave it in
  a first-deploy script and remove it afterwards.
- Run `npm run seed` **once**, before the shop starts using the app, so the admin account
  and the pricing/delivery defaults exist.
- The process must be kept alive by the platform (systemd, Docker `restart: always`, a
  process manager). The notification worker starts with the API, so one healthy process
  is enough; several instances are also fine.

## 3. Environment variables

Set every required variable from `.env.example`. The API refuses to boot when a required
one is missing or a secret is too short, which is deliberate.

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | the port the platform routes to |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | `openssl rand -hex 32`, unique per environment |
| `OTP_HASH_SECRET` | a second, different `openssl rand -hex 32` |
| `CORS_ORIGINS` | the exact web/app origins; never `*` in production |
| `DEV_FIXED_OTP_ENABLED` | `false` (the fixed OTP is hard-disabled in production anyway) |
| `SEED_*` | only used by the seed script |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | needed for online payment |
| `RAZORPAY_WEBHOOK_SECRET` | the secret set in the Razorpay dashboard |
| `NOTIFICATIONS_ENABLED` | `true` to send order messages |
| `NOTIFICATION_CHANNELS` | `PUSH,SMS` by default; add `WHATSAPP` when it is wired |
| `PUSH_PROVIDER_KEY` / `SMS_PROVIDER_KEY` / `WHATSAPP_PROVIDER_KEY` | leave empty until the provider integration is written |
| `SHOP_NAME`, `SHOP_ADDRESS`, `SHOP_PHONE`, `SHOP_GST_NUMBER` | printed on every invoice |
| `INVOICE_PREFIX` | default `SAR-INV` |

Never commit `.env`. On a platform, use its secret store.

## 4. After the first deploy

- [ ] `GET /health` answers `200`.
- [ ] `GET /docs` opens the API reference (disable it publicly if the shop does not want
      the contract visible).
- [ ] Log in with the seeded admin phone (`SEED_ADMIN_PHONE`) using the real OTP flow, and
      change the phone to the owner's if the default was used.
- [ ] `GET /admin/dashboard` answers with empty but valid data.
- [ ] Place one real test order end to end: add to cart, checkout with cash on delivery,
      open the invoice PDF, move it to PACKED / OUT_FOR_DELIVERY / DELIVERED, and confirm
      the messages appear in `GET /admin/notifications` (as `SENT` when a provider is
      configured, or logged when no provider key is set).
- [ ] Download both reports and open them in Excel.
- [ ] `GET /admin/audit-logs` shows the test changes you just made.
- [ ] If online payment is on, run one ₹1 Razorpay payment and check it appears as `PAID`,
      then refund it in the Razorpay dashboard.

## 5. Every later release

- [ ] Take a database backup (or confirm the platform's automatic one ran).
- [ ] `npm ci && npx prisma migrate deploy && npm run build`, then restart.
- [ ] Do **not** run `npm run seed` again unless you want sample data on that environment;
      it is safe but unnecessary.
- [ ] Check `/health` and the logs for `Notification worker run failed` or
      `Could not write the audit log`.
- [ ] Read `docs/CHANGELOG-API.md` for the release and tell the frontend developer what
      changed.

## 6. Backups and operations

- **Database:** daily automated backups with point-in-time recovery where available. The
  orders, invoices and audit log are the shop's records; the audit log is append-only by
  design and should never be deleted.
- **Redis:** no backup needed. It holds OTPs and counters.
- **Logs:** the logger writes structured lines; keep them for at least 30 days. Every
  response carries an `X-Request-Id` (and `requestId` in error bodies), so a customer
  complaint can be traced to the exact request.
- **Stuck notifications:** if messages pile up as `PENDING`, check
  `GET /admin/notifications?status=PENDING` and the logs, then
  `POST /admin/notifications/process` to force a run. `FAILED` rows keep the provider's
  error in `lastError` and can be retried from the admin API.
- **Restoring:** `pg_restore` the backup into a fresh database, point `DATABASE_URL` at it,
  and restart. Nothing else lives on disk.

## 7. Scaling notes

- The API is stateless; run as many instances as traffic needs.
- The notification queue is claimed with `FOR UPDATE SKIP LOCKED`, so extra instances do
  not send duplicates. Keep one worker per instance unless you split the worker into its
  own process (then set `NOTIFICATIONS_ENABLED=false` on the web instances).
- The order list, the admin list and the catalogue search have indexes from migration
  `20261123123000_search_and_list_indexes`; on a large catalogue make sure `pg_trgm` is
  installed so the trigram indexes exist.

## 8. What is intentionally not handled here

- **TLS** terminates at the platform or reverse proxy, not in this app.
- **SMS/push/WhatsApp providers** are behind an interface and intentionally unimplemented:
  without a key the message is logged; with a key and no integration the attempt fails
  loudly and is retried. Implement `NotificationProvider` before setting a key.
- **Tax filing** (CGST/SGST splits) is the accountant's job. The invoice records exactly
  what the buyer was charged.
