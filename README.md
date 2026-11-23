# Sarvodaya API

Backend for **Sarvodaya**, a hardware shop app (TMT steel, cement, paint, nuts, bolts, screws)
used by customers, contractors and the shop owner (admin).

**Step 1: accounts and login.** **Step 2: product catalogue.**
**Step 3: pricing, cart and delivery charges.**
**Step 4: orders and payments.**
**Step 5: admin tools, notifications and invoices.**
**Step 6 (this branch): final review - order isolation checks, list and search indexes, a
deployment checklist and a one-page API summary.**

Accounts and login:

* Phone + OTP login only — no passwords, no approval step.
* Sign-up as **Customer** or **Contractor** (chosen once, at sign-up).
* **Admin** accounts exist only through the seed script.
* Profile: name and phone required, company name and GST number optional.
* Saved delivery addresses and project sites, both with pincode and optional latitude/longitude.
* Admin block flag that disables login and invalidates existing tokens immediately.
* OpenAPI docs at `/docs`, one success format, one error format with stable error codes.
* Docker image, Docker Compose stack, and a GitHub Actions workflow that runs the tests on every PR.

Catalogue:

* Categories and sub-categories (Steel, Cement, Paint, Fasteners, Plumbing), created and
  reordered by the admin — nothing about them is hard-coded.
* Products with a unique SKU, brand, size/variant, unit (`kg`, `bag`, `piece`, `litre`, `box`),
  price in paise, photos and stock.
* Public product list with search, category/brand/price/stock filters, sorting and pagination.
  Customers see an `inStock` flag, never the exact count.
* Admin can add, edit and hide products, change stock with an absolute value or an adjustment,
  and bulk import from Excel with a row-by-row error report.
* The seed script fills 21 categories and 33 realistic products, safely re-runnable.

Pricing, cart and delivery:

* Automatic pricing, no quotes and no approvals: contractor special price first, then bulk
  quantity discount, then contractor percentage rule (for example 5% off cement), then the normal
  price. Every cart line returns `unitPricePaise`, `originalPricePaise` and `appliedRule`.
* A server-side cart per account, so it survives app restarts. Each line is priced on every read.
* Charges returned as separate lines: item total, minimum-order charge (with
  `amountToAvoidChargePaise` for "add ₹200 more to remove this charge"), distance charge from the
  shop using admin-defined distance slabs, free delivery above an amount or within a radius, and
  the grand total.
* Delivery only to approved pincodes, with a polite error otherwise; beyond the last slab the
  cart answers `OUT_OF_DELIVERY_RANGE`.
* Admins manage all of it through APIs: settings, contractor prices, bulk discounts, contractor
  rules, slabs and pincodes. No code change needed to alter any amount or area.

Orders and payments:

* Checkout turns the stored cart into an order with a delivery address, an optional delivery
  date or slot, and notes. Prices, charges and the address are frozen on the order, so a later
  price change never rewrites a past sale.
* Stock is reduced in the same database transaction as the order, with a conditional update, so
  two buyers can never both get the last item.
* An `Idempotency-Key` header makes checkout safe to retry: the same key returns the same order
  instead of placing a second one.
* Statuses are `CONFIRMED`, `PACKED`, `OUT_FOR_DELIVERY`, `DELIVERED` and `CANCELLED`. Only the
  admin moves an order forward, every change is written to its history, and cancelling restores
  the stock exactly once.
* Order history, one order detail, and a one-tap reorder that puts the items back in the cart.
* The admin can waive the minimum order charge or the delivery charge on a single order.
* Payment is online through Razorpay (the server verifies the checkout signature and the
  webhook; the client is never trusted), cash on delivery, or pay later on credit terms the
  admin grants a contractor. Payment state is `PENDING`, `PARTIALLY_PAID` or `PAID`; the admin
  records cash received, and COD is allowed for every order size.

Admin, notifications and invoices:

* An owner dashboard in one call: today's orders and sales, everything still to be
  delivered, products running low on stock, and cash-on-delivery money still to collect.
* Admin lists of customers and contractors with order totals, last order date and — for
  contractors — credit limit and outstanding balance.
* Excel downloads: a sales report (one row per order plus a summary sheet) and an order
  report at item level, for any date range.
* An append-only audit log of every admin change: who, what, which record, the body that
  was accepted, the IP and the request id. Reads are never logged.
* Customer notifications on order placed, confirmed, dispatched and delivered, over push
  and SMS or WhatsApp, through a database-backed queue with exponential retries, so a
  provider outage never blocks an order and a restart never loses a message.
* A PDF invoice for every order, created in the same transaction as the order: a tax
  invoice with the buyer's GST number when they gave one, a plain bill otherwise, with
  every charge on its own line.

## Stack

Node.js 20+ · TypeScript · Express 5 · PostgreSQL 16 · Prisma · Redis · PDFKit · ExcelJS · Docker · Vitest + Supertest

Money is stored as integer **paise** throughout the project. Nothing the shop owner may change is
hard-coded: catalogue prices, stock and categories are data managed through the admin APIs, and
discounts, charges, slabs and serviceable pincodes arrive the same way in later steps.

## Quick start with Docker

Requires Docker and Docker Compose.

```bash
cp .env.example .env      # then edit JWT_SECRET and OTP_HASH_SECRET
docker compose up --build
```

That starts PostgreSQL, Redis and the API, applies migrations, and serves
`http://localhost:3000` with docs at `http://localhost:3000/docs`.

Seed the admin account and sample data (one-off):

```bash
docker compose exec api npm run seed
```

## Local development without Docker

Requires Node.js 20+, a PostgreSQL 16 database and a Redis server.

```bash
cp .env.example .env
npm install
npx prisma migrate deploy      # or: npx prisma migrate dev
npm run seed                   # admin, sample customer/contractor, categories and products
npm run dev                    # http://localhost:3000
```

Create the databases first, for example:

```bash
createdb sarvodaya
createdb sarvodaya_test
```

## Environment variables

Everything is declared in [`.env.example`](.env.example). Never commit `.env`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | yes | Redis connection string (OTP storage, rate limits) |
| `JWT_SECRET` | yes | at least 32 characters, different per environment |
| `OTP_HASH_SECRET` | yes | at least 32 characters, keys the OTP hash |
| `CORS_ORIGINS` | yes | comma separated frontend origins, or `*` |
| `JWT_EXPIRES_IN` | no | default `30d` |
| `OTP_TTL_SECONDS` | no | default `300` (5 minutes) |
| `OTP_MAX_ATTEMPTS` | no | default `5` |
| `OTP_RESEND_COOLDOWN_SECONDS` | no | default `60` |
| `OTP_REQUESTS_PER_WINDOW` / `OTP_WINDOW_SECONDS` | no | default 5 per phone per hour |
| `OTP_REQUESTS_PER_IP_PER_WINDOW` | no | default 30 per IP per hour |
| `DEV_FIXED_OTP` | no | default `123456`, ignored in production |
| `SEED_ADMIN_PHONE` | no | default `9999999999` |
| `SEED_SAMPLE_USERS` | no | default `true`; `false` seeds only the admin |
| `SEED_SAMPLE_PRODUCTS` | no | default `true`; `false` skips the catalogue seed |
| `SEED_PRICING` | no | default `true`; `false` skips the pricing, slabs and pincode seed |
| `SEED_CREDIT_TERMS` | no | default `true`; `false` skips the sample contractor credit terms |
| `NOTIFICATIONS_ENABLED` | no | default `true`; `false` stops queueing and sending |
| `NOTIFICATION_CHANNELS` | no | default `PUSH,SMS`; any of `PUSH`, `SMS`, `WHATSAPP` |
| `NOTIFICATION_MAX_ATTEMPTS` | no | default `5` delivery attempts per message |
| `NOTIFICATION_RETRY_BASE_SECONDS` | no | default `60`; the backoff doubles per attempt |
| `NOTIFICATION_POLL_INTERVAL_MS` | no | default `15000`; how often the worker looks for work |
| `PUSH_PROVIDER_KEY` / `SMS_PROVIDER_KEY` / `WHATSAPP_PROVIDER_KEY` | no | without a key the message is logged instead of sent |
| `SHOP_NAME` / `SHOP_ADDRESS` / `SHOP_PHONE` | no | printed at the top of every invoice |
| `SHOP_GST_NUMBER` | no | printed on invoices only when set |
| `INVOICE_PREFIX` | no | default `SAR-INV`; invoice numbers look like `SAR-INV-000001` |
| `RAZORPAY_KEY_ID` | for online payment | Razorpay key id, sent to the app as `keyId` |
| `RAZORPAY_KEY_SECRET` | for online payment | Razorpay key secret, used to verify the checkout signature (never sent to the app) |
| `RAZORPAY_WEBHOOK_SECRET` | for webhooks | Secret configured in the Razorpay dashboard; without it the webhook endpoint stays closed |
| `RAZORPAY_BASE_URL` | no | default `https://api.razorpay.com` |

Generate secrets with:

```bash
openssl rand -hex 32
```

## Test assets

* **Fixed OTP in development/test: `123456`** (also returned as `devOtp` by the request-OTP
  endpoint). It is hard-disabled when `NODE_ENV=production`.
* Seed accounts: admin `9999999999`, sample customer `9876543210`, sample contractor `9123456780`.
* Seed catalogue: 21 categories (5 parents) and 33 products with SKUs like `STL-TMT-008` and
  `CEM-ULT-PPC`. Re-running `npm run seed` never duplicates them and never overwrites prices or
  stock the owner has changed.
* Seed credit terms: the sample contractor `9123456780` starts with pay-later terms (₹2,00,000
  limit, 30 days), so the CREDIT payment method can be tried straight away.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch-mode dev server |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Vitest + Supertest suite |
| `npm run prisma:migrate` | `prisma migrate deploy` |
| `npm run seed` | Create the admin account and sample data (idempotent) |

## API

Base URL: `/api/v1`. Interactive docs: `/docs`, raw spec: `/docs/openapi.yaml`,
health check: `/health`.

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/auth/otp/request` | public |
| POST | `/auth/otp/verify` | public |
| GET | `/auth/me` | Bearer |
| GET / PATCH | `/me` | Bearer |
| GET / POST | `/me/addresses` | Bearer |
| GET / PATCH / DELETE | `/me/addresses/{id}` | Bearer |
| GET / POST | `/me/project-sites` | Bearer |
| GET / PATCH / DELETE | `/me/project-sites/{id}` | Bearer |
| GET | `/admin/users` | Bearer + Admin |
| GET | `/admin/users/{id}` | Bearer + Admin |
| POST | `/admin/users/{id}/block` | Bearer + Admin |
| POST | `/admin/users/{id}/unblock` | Bearer + Admin |
| GET | `/categories` | public |
| GET | `/products` | public |
| GET | `/products/{id}` | public |
| GET / POST | `/admin/categories` | Bearer + Admin |
| PATCH / DELETE | `/admin/categories/{id}` | Bearer + Admin |
| GET / POST | `/admin/products` | Bearer + Admin |
| GET / PATCH | `/admin/products/{id}` | Bearer + Admin |
| PATCH | `/admin/products/{id}/stock` | Bearer + Admin |
| POST | `/admin/products/import` | Bearer + Admin |
| GET / DELETE | `/cart` | Bearer |
| POST | `/cart/items` | Bearer |
| PATCH / DELETE | `/cart/items/{id}` | Bearer |
| PUT | `/cart/delivery` | Bearer |
| GET / POST | `/orders` | Bearer |
| GET | `/orders/{id}` | Bearer |
| POST | `/orders/{id}/cancel` | Bearer |
| POST | `/orders/{id}/reorder` | Bearer |
| POST | `/orders/{id}/payments/online` | Bearer |
| POST | `/payments/razorpay/verify` | Bearer |
| POST | `/payments/razorpay/webhook` | signature |
| GET | `/admin/orders` | Bearer + Admin |
| GET | `/admin/orders/{id}` | Bearer + Admin |
| PATCH | `/admin/orders/{id}/status` | Bearer + Admin |
| POST | `/admin/orders/{id}/cancel` | Bearer + Admin |
| POST | `/admin/orders/{id}/waive-charge` | Bearer + Admin |
| POST | `/admin/orders/{id}/payments` | Bearer + Admin |
| GET / POST | `/admin/credit-terms` | Bearer + Admin |
| GET / PATCH / DELETE | `/admin/credit-terms/{id}` | Bearer + Admin |
| GET | `/orders/{id}/invoice` | Bearer |
| GET | `/orders/{id}/invoice/details` | Bearer |
| GET / DELETE | `/me/notifications` | Bearer |
| POST / DELETE | `/me/notifications/device-tokens` | Bearer |
| GET | `/admin/dashboard` | Bearer + Admin |
| GET | `/admin/customers` | Bearer + Admin |
| GET | `/admin/contractors` | Bearer + Admin |
| GET | `/admin/reports/sales.xlsx` | Bearer + Admin |
| GET | `/admin/reports/orders.xlsx` | Bearer + Admin |
| GET | `/admin/audit-logs` | Bearer + Admin |
| GET | `/admin/notifications` | Bearer + Admin |
| POST | `/admin/notifications/process` | Bearer + Admin |
| POST | `/admin/notifications/{id}/retry` | Bearer + Admin |
| GET | `/admin/orders/{id}/invoice` | Bearer + Admin |
| GET / PATCH | `/admin/pricing/settings` | Bearer + Admin |
| GET / POST | `/admin/pricing/contractor-prices` | Bearer + Admin |
| PATCH / DELETE | `/admin/pricing/contractor-prices/{id}` | Bearer + Admin |
| GET / POST | `/admin/pricing/bulk-discounts` | Bearer + Admin |
| PATCH / DELETE | `/admin/pricing/bulk-discounts/{id}` | Bearer + Admin |
| GET / POST | `/admin/pricing/contractor-rules` | Bearer + Admin |
| PATCH / DELETE | `/admin/pricing/contractor-rules/{id}` | Bearer + Admin |
| GET / POST | `/admin/delivery/slabs` | Bearer + Admin |
| PATCH / DELETE | `/admin/delivery/slabs/{id}` | Bearer + Admin |
| GET / POST | `/admin/delivery/pincodes` | Bearer + Admin |
| PATCH / DELETE | `/admin/delivery/pincodes/{pincode}` | Bearer + Admin |

### Response formats

Success:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 } }
```

Error:

```json
{
  "success": false,
  "error": { "code": "OTP_INVALID", "message": "Incorrect OTP", "details": { "remainingAttempts": 4 } },
  "requestId": "5c0c4a3e-9a4a-4f1e-9a0d-1c2b3a4d5e6f"
}
```

Codes are stable and listed in `src/config/error-codes.ts` and `docs/openapi.yaml`.
See [`docs/CHANGELOG-API.md`](docs/CHANGELOG-API.md) for the per-PR summary written for the
frontend developer.

## OTP behaviour

1. `POST /auth/otp/request` — generates a 6 digit OTP, stores only an HMAC hash in Redis with a
   5 minute TTL, and applies a per-phone cooldown plus per-phone and per-IP hourly limits.
   Blocked accounts are refused here.
2. `POST /auth/otp/verify` — checks the OTP (max 5 attempts), then either logs the user in or
   creates the account. A new account needs `accountType` (`CUSTOMER`/`CONTRACTOR`) and `name`.
   `ADMIN` is rejected: admin accounts come only from the seed script.
3. OTPs are single use and scoped to the phone number.

SMS delivery is stubbed in Step 1 behind the `SmsSender` interface in
`src/modules/auth/sms.provider.ts`; the OTP is logged to the server console in non-production.
Implementing MSG91/Twilio/etc. means writing one class — no route or service changes.

## Catalogue and Excel import

`GET /products` is the shop window: hidden products never appear and stock is exposed only as
`inStock`. Admins manage everything through `/admin/categories` and `/admin/products`.

`POST /admin/products/import` takes an `.xlsx` file in the multipart field `file` (max 5 MB,
first worksheet, up to 5000 rows). Header names are matched case-insensitively and accept
spaces, dashes or underscores.

| Column | Required | Notes |
| --- | --- | --- |
| `sku` | yes | Unique. Rows are matched by SKU, so re-running a sheet updates products. |
| `name` | yes | Product name. |
| `category` | yes | Slug (`tmt-bars`), name (`TMT Bars`), path (`Steel > TMT Bars`), or a sub-category name that is unique across the shop. |
| `brand` | yes | |
| `unit` | yes | `kg`, `bag`, `piece`, `litre` or `box`. |
| `price` | yes | In **rupees**, converted to paise (`345.50` → `34550`). |
| `size_variant` | no | Aliases: `size`, `variant`. |
| `stock` | no | Defaults to `0`. Aliases: `qty`, `quantity`. |
| `description` | no | |
| `photos` | no | Comma separated URLs. Aliases: `photo`, `image`. |

The response is a report — `totalRows`, `created`, `updated`, `failed` and an `errors` array with
the spreadsheet `row` (header is row 1), `sku`, failing `field` and a human `message`. Valid rows
are saved even when other rows fail, and a re-import never changes `isActive`, so a hidden
product stays hidden.

## Orders, payments and credit

Checkout turns the stored cart into an order inside one database transaction: prices, charges and
the delivery address are frozen on the order, stock is reduced with a conditional update so the last
item is never sold twice, and an `Idempotency-Key` header makes a double tap or a retry return the
same order. The admin moves the status forward with a full history, cancelling restores stock, and
payments are online (Razorpay, signature and webhook verified on the server), cash on delivery, or
pay later on credit terms the admin grants a contractor.

Details, including the exact status flow and the payment rules, are in
[`docs/orders-and-payments.md`](docs/orders-and-payments.md). The dashboard, reports,
audit log, notification queue and invoices are explained in
[`docs/admin-and-notifications.md`](docs/admin-and-notifications.md).

## Tests

```bash
npm test
```

The suite runs against a **real** PostgreSQL database and a real Redis, using
`TEST`-style throwaway settings and truncating tables between tests. Defaults:

```
DATABASE_URL=postgresql://sarvodaya:sarvodaya@localhost:5432/sarvodaya_test?schema=public
REDIS_URL=redis://localhost:6379/1
```

Override them with environment variables if your local services differ. CI does this
automatically (see `.github/workflows/ci.yml`) for every pull request to `main`.

Covered: OTP request/verify, cooldown and rate limiting, OTP expiry and attempt limits,
sign-up rules (account type, admin rejection), blocked-account login refusal, profile update and
GST validation, address and project-site CRUD with ownership isolation, the admin block/unblock
flow, the public catalogue (tree, search, filters, sorting, pagination, hidden products, stock
flag), admin catalogue CRUD and stock changes, and the Excel import (create, re-run update,
per-row error report, hidden products staying hidden, bad files), the pricing order (normal,
bulk, contractor percentage, contractor special price, most specific rule wins, inactive rules
ignored), the server-side cart (persistence, add/update/remove/clear, hidden products), the
charges (minimum order with the amount to avoid it, distance slabs, free delivery by amount and
by radius), the delivery restrictions (unapproved pincode, beyond the last slab, no address),
the admin pricing and delivery APIs including slab overlap and duplicate pincodes, the orders
(checkout, frozen prices, the idempotency replay, the last item never being sold twice, cancellation
restoring stock, forward-only statuses with history, charge waivers and reorder), the payments
(cash receipts, partial and full payment, Razorpay intents, checkout signature verification and the
signed webhook), contractor credit terms (granting, switching off, and the credit limit),
the admin dashboard (today's orders, pending deliveries, low stock with its threshold, COD
outstanding), order isolation (one account never lists, opens, cancels, reorders or
invoices another account's order, and the `userId` filter is ignored for customers), the
customer and contractor lists with their totals, the Excel sales and order
reports including the invalid date range, the audit log (who changed what, reads and failed
changes not logged, admin only), the notification queue (placed on checkout, confirmed,
dispatched and delivered, push plus SMS, retries and the admin retry), and invoices (a bill
without GST, a tax invoice with a buyer GSTIN, the PDF, and the frozen amount).

## Isolation, indexes and the final review

* **Ownership.** Every customer query is filtered by the id in the token, never by a value
  the client sends: order list and detail, cancel, reorder, invoice, cart, addresses,
  project sites and notifications. Another account's order id answers `404 NOT_FOUND`,
  exactly like an id that does not exist, so nothing can be learned from the response. The
  test `lists the order history and hides other accounts orders` covers the whole set,
  including the ignored `userId` filter.
* **Order lists.** `Order` is indexed on `(userId, placedAt)` for a customer's history and
  `(status, placedAt)` for the admin list and the dashboard, plus `status`, `paymentStatus`
  and `placedAt` on their own.
* **Search.** Product search and the admin order search use `contains` (`ILIKE '%term%'`),
  which a btree cannot serve. Migration `20261123123000_search_and_list_indexes` adds
  `pg_trgm` GIN indexes on `Product.name`, `Product.brand`, `Product.sku`, `Order.orderNumber`
  and `User.name`, and a btree on `(isActive, name)` for catalogue browsing. If the deploy
  account cannot create the extension the migration says so and skips those indexes;
  search keeps working on a sequential scan.
* **Review documents.** [`docs/deployment-checklist.md`](docs/deployment-checklist.md) is
  what to do before and after a deploy; [`docs/api-summary.md`](docs/api-summary.md) is the
  one-page overview for the frontend developer.

## Project structure

```
prisma/
  schema.prisma          data model (users, addresses, project sites, catalogue, pricing, cart)
  migrations/            SQL migrations, applied by `prisma migrate deploy`
  seed.ts                admin, sample users, categories and products (idempotent)
  pricing.seed.ts        shop settings, slabs, pincodes, contractor prices and discount rules
src/
  app.ts                 Express app factory (CORS, helmet, docs, error handling)
  index.ts               server bootstrap + graceful shutdown
  routes.ts              mounts every module router
  config/                validated env and the stable error-code list
  lib/                   Prisma, Redis, JWT, OTP hashing, geo, HTTP helpers, logger
  middleware/            request id, auth, admin guard, validation, error handler
  modules/auth/          OTP request/verify, OTP store, SMS provider interface
  modules/users/         profile, saved addresses, project sites
  modules/catalog/       categories, products, admin CRUD, Excel import
  modules/pricing/       pricing engine, settings, contractor prices, bulk and contractor rules
  modules/cart/          server-side cart, priced lines and charges
  modules/delivery/      distance slabs, serviceable pincodes, delivery quote
  modules/orders/        checkout, order history, cancellation, reorder, status history
  modules/payments/      Razorpay intents, signature verification, webhook, cash receipts
  modules/credit/        contractor credit terms and the outstanding balance
  modules/dashboard/     the owner's dashboard
  modules/notifications/ notification queue, worker, channels and device tokens
  modules/invoices/      invoice records and the PDF renderer
  modules/reports/       Excel sales and order reports
  modules/audit/         audit log and the middleware that records admin changes
  modules/admin/         user list, block/unblock, customers and contractors
  docs/                  Swagger UI + raw OpenAPI (merged from docs/*.yaml)
  types/                 shared TypeScript types
docs/
  openapi.yaml           root of the contract the frontend builds against
  data.paths.yaml        Step 1 paths
  catalogue.paths.yaml   Step 2 paths
  step3.paths.yaml       Step 3 cart paths
  pricing.paths.yaml     Step 3 admin pricing paths
  delivery.paths.yaml    Step 3 admin delivery paths
  schemas.openapi.yaml   Step 1 and 2 schemas
  step3.schemas.yaml     Step 3 schemas
  step4.paths.yaml       Step 4 order and payment paths
  admin-orders.paths.yaml Step 4 admin order and credit paths
  step4.schemas.yaml     Step 4 schemas
  step5.paths.yaml       Step 5 dashboard, notifications, invoices, reports, audit
  step5.schemas.yaml     Step 5 schemas
  deployment-checklist.md what to set and check before and after a deploy
  api-summary.md         one-page API overview for the frontend developer
  CHANGELOG-API.md       per-PR notes for the frontend developer
tests/                   Vitest + Supertest integration tests
```

## Workflow

* `main` is always deployable; every step is a branch plus a pull request.
* CI must be green before merging: `npm install`, `prisma generate`, `prisma migrate deploy`,
  `npm run typecheck`, `npm test`.
* `package-lock.json` is not committed yet (the first clone generates it). Commit the lockfile
  once your local install produces it so later builds are reproducible; `npm install` and CI
  honour it automatically.
* Every PR updates `docs/CHANGELOG-API.md`.
* Secrets only ever live in environment variables; `.env` is git-ignored.
