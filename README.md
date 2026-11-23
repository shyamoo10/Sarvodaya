# Sarvodaya API

Backend for **Sarvodaya**, a hardware shop app (TMT steel, cement, paint, nuts, bolts, screws)
used by customers, contractors and the shop owner (admin).

**Step 1: accounts and login.** **Step 2 (this branch): product catalogue.**

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

## Stack

Node.js 20+ · TypeScript · Express 5 · PostgreSQL 16 · Prisma · Redis · Docker · Vitest + Supertest

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
per-row error report, hidden products staying hidden, bad files).

## Project structure

```
prisma/
  schema.prisma          data model (users, addresses, project sites, catalogue)
  migrations/            SQL migrations, applied by `prisma migrate deploy`
  seed.ts                admin, sample users, categories and products (idempotent)
src/
  app.ts                 Express app factory (CORS, helmet, docs, error handling)
  index.ts               server bootstrap + graceful shutdown
  config/                validated env and the stable error-code list
  lib/                   Prisma, Redis, JWT, OTP hashing, HTTP helpers, logger
  middleware/            request id, auth, admin guard, validation, error handler
  modules/auth/          OTP request/verify, OTP store, SMS provider interface
  modules/users/         profile, saved addresses, project sites
  modules/catalog/       categories, products, admin CRUD, Excel import
  modules/admin/         user list, block/unblock
  docs/                  Swagger UI + raw OpenAPI
docs/
  openapi.yaml           the contract the frontend builds against
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
