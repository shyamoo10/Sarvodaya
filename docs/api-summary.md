# API summary for the frontend developer

One page. Base URL `/api/v1`; interactive reference at `/docs`, raw spec at
`/docs/openapi.yaml`, health at `/health`.

## The two shapes you build on

```json
{ "success": true, "data": ..., "meta": { "page": 1, "limit": 20, "total": 40, "totalPages": 2 } }
{ "success": false, "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "details": {} }, "requestId": "..." }
```

`meta` only on paginated lists. Switch on `error.code` — it is stable; `error.message` is
for humans. Every response carries `X-Request-Id`; send your own to trace a report.

All money is integer **paise** (`23700` = ₹237.00). Send `Authorization: Bearer <jwt>`.

## Accounts

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/otp/request` | `{ phone }` → `isNewUser`, `resendAfterSeconds`, and `devOtp` outside production |
| POST | `/auth/otp/verify` | `{ phone, otp, accountType?, name? }` — `accountType` + `name` only for a new account |
| GET | `/auth/me` | the account behind the token |
| GET / PATCH | `/me` | profile; `companyName` and `gstNumber` optional |
| GET / POST | `/me/addresses`, `/me/project-sites` | CRUD at `/{id}` |

Fixed development OTP: `123456`. Admin accounts exist only through the seed script.
A blocked account answers `403 USER_BLOCKED` — clear the token and show a "contact the
shop" screen.

## Catalogue

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/categories` | two levels: roots with `children[]` |
| GET | `/products` | `search`, `category` (slug), `brand`, `minPricePaise`, `maxPricePaise`, `inStock`, `sort`, `page`, `limit` |
| GET | `/products/{id}` | hidden products answer `404` |

Customers see `inStock` (boolean), never a stock count. Units are `kg`, `bag`, `piece`,
`litre`, `box`.

## Cart and checkout

| Method | Path | Notes |
| --- | --- | --- |
| GET / DELETE | `/cart` | priced on every read; `charges[]` are `ITEM_TOTAL`, `MIN_ORDER_CHARGE`, `DISTANCE_CHARGE` |
| POST | `/cart/items` | `{ productId, quantity }` (adds to an existing line) |
| PATCH / DELETE | `/cart/items/{id}` | set quantity / remove |
| PUT | `/cart/delivery` | `{ addressId }` or `{ addressId: null }` |
| POST / GET | `/orders` | checkout / your order history |
| GET | `/orders/{id}` | one order with frozen prices and `timeline[]` |
| POST | `/orders/{id}/cancel` | only while `CONFIRMED` |
| POST | `/orders/{id}/reorder` | `{ cart, added, skipped[] }` |
| POST | `/orders/{id}/payments/online` | Razorpay intent: `{ keyId, razorpayOrderId, amountPaise, currency }` |
| POST | `/payments/razorpay/verify` | makes the order paid — the client alone never does |
| POST | `/payments/razorpay/webhook` | server to server |

Checkout body: `addressId?`, `deliveryDate` (`YYYY-MM-DD`, today or later), `deliverySlot?`,
`notes?`, `paymentMethod` (`ONLINE` | `CASH_ON_DELIVERY` | `CREDIT`, default
`CASH_ON_DELIVERY`). Send an `Idempotency-Key` header (8–128 chars) so a double tap returns
the same order (`200` + `Idempotent-Replayed: true`) instead of placing a second one.
Display prices from the order, never recompute. Statuses move one way:
`CONFIRMED → PACKED → OUT_FOR_DELIVERY → DELIVERED`, or `CANCELLED`.

## Invoices and messages

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/orders/{id}/invoice` | PDF, `inline` |
| GET | `/orders/{id}/invoice/details` | `kind` is `TAX_INVOICE` (buyer gave a GSTIN) or `BILL` |
| GET / DELETE | `/me/notifications` | in-app inbox, filter `status`, `channel` |
| POST / DELETE | `/me/notifications/device-tokens` | `{ token, platform }` — the push token, not a phone |

Notifications are queued server-side at checkout and on each status change; there is
nothing to call.

## Admin (Bearer + ADMIN)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/dashboard` | `today`, `pendingDeliveries`, `lowStock`, `cashOnDelivery`; `lowStockThreshold` (default 10) |
| GET | `/admin/orders` | filters `status`, `paymentStatus`, `paymentMethod`, `userId`, `search`, `from`, `to` |
| GET / PATCH | `/admin/orders/{id}`, `/admin/orders/{id}/status` | detail / `{ status, note? }` |
| POST | `/admin/orders/{id}/cancel`, `/waive-charge`, `/payments` | cancel, waive one charge, record cash |
| GET | `/admin/orders/{id}/invoice` | PDF download |
| GET / POST | `/admin/categories`, `/admin/products` | catalogue management |
| PATCH | `/admin/products/{id}/stock` | exactly one of `stockQuantity` or `adjustment` |
| POST | `/admin/products/import` | `.xlsx` in field `file`; always returns a row-by-row report |
| GET / PATCH | `/admin/pricing/settings` | minimum order, charges, free delivery, shop location |
| GET / POST … | `/admin/pricing/contractor-prices`, `/bulk-discounts`, `/contractor-rules` | change and delete at `/{id}` |
| GET / POST … | `/admin/delivery/slabs`, `/admin/delivery/pincodes` | change and delete at `/{id}` / `/{pincode}` |
| GET / POST … | `/admin/credit-terms`, `/admin/credit-terms/{id}` | contractor pay-later terms |
| GET | `/admin/customers`, `/admin/contractors` | totals, last order; contractors add `credit` |
| GET | `/admin/reports/sales.xlsx`, `/admin/reports/orders.xlsx` | real `.xlsx` downloads; `from`, `to`, `status`, `paymentStatus` |
| GET | `/admin/audit-logs` | filters `actorId`, `entityType`, `entityId`, `action`, `from`, `to` |
| GET | `/admin/notifications` | the queue; `POST /process` forces a run, `POST /{id}/retry` re-queues a failure |
| GET / POST | `/admin/users` | list/search, `/{id}`, `/{id}/block`, `/{id}/unblock` |

## Errors worth handling by name

`VALIDATION_ERROR` (400, `details[]` has `field` + `message`), `UNAUTHORIZED` (401),
`FORBIDDEN` / `USER_BLOCKED` (403), `NOT_FOUND` (404), `OTP_*` (login flow),
`INSUFFICIENT_STOCK` (409, `details.availableQuantity`), `PINCODE_NOT_SERVICEABLE` /
`OUT_OF_DELIVERY_RANGE` (400, polite notice with an alternative), `CREDIT_LIMIT_EXCEEDED`
(400, `details.availablePaise`), `INVALID_ORDER_STATUS_CHANGE` (409,
`details.allowedNextStatuses`), `CHARGE_ALREADY_WAIVED` (409), `REPORT_RANGE_INVALID` (400),
`NOTIFICATION_NOT_RETRYABLE` (409). The full list lives in `src/config/error-codes.ts`.

## Practical notes

- A customer can only ever read and act on their own orders; someone else's id answers
  `404`, the same as a missing order.
- Reports are binary: read `Content-Disposition` for the file name and save the bytes.
- Nothing is cached server-side, so refresh the dashboard after a status change.
- Per-step detail for the frontend is in `docs/CHANGELOG-API.md`.
