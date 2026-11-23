# API changelog

All changes the frontend developer needs to know about, newest first.
Every pull request updates this file.

---

## Step 6 - Final review

**Branch:** `step-6-final-review`
**Version:** v1.4.1

### Added endpoints

None. This step changes no request and no response shape, so nothing on the frontend needs
to change.

### Notes for the frontend

* **Ownership is enforced on every order route.** A customer's list is filtered by the token,
  and another account's order id answers `404` for detail, cancel, reorder and invoice. The
  `userId` query filter on `GET /orders` is honoured for admins only, so passing it as a
  customer changes nothing. Treat a `404` on an order as "not mine or not there" - it is
  deliberately the same answer.
* **New indexes, same contract.** Migration `20261123123000_search_and_list_indexes` adds
  `(status, placedAt)` on orders, `(isActive, name)` on products and trigram indexes for the
  text searches (product name, brand, sku; order number; customer name). Search and the order
  lists get faster; no field, code or status changed.
* **New docs:** `docs/deployment-checklist.md` for whoever deploys, and
  `docs/api-summary.md`, a one-page summary of every endpoint the app calls with the error
  codes worth handling by name.

### Changed

* `tests/orders.test.ts` now asserts the full isolation set: the other account's list is
  empty, and detail, cancel, reorder and invoice all answer `404`.
* README gained a short section on isolation and indexes and links to the two new documents.

### Deprecated

* Nothing.

---

## Step 5 - Admin tools, notifications and invoices

**Branch:** `step-5-admin-notifications`
**Version:** v1.4.0

### Added endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/api/v1/admin/dashboard` | Bearer + Admin | Today's orders, pending deliveries, low stock, COD outstanding |
| GET | `/api/v1/admin/customers` | Bearer + Admin | Customers with order totals and last order date |
| GET | `/api/v1/admin/contractors` | Bearer + Admin | Contractors with order totals and credit position |
| GET | `/api/v1/admin/reports/sales.xlsx` | Bearer + Admin | Excel sales report (orders + summary sheet) |
| GET | `/api/v1/admin/reports/orders.xlsx` | Bearer + Admin | Excel report of every item sold |
| GET | `/api/v1/admin/audit-logs` | Bearer + Admin | Audit trail of admin changes |
| GET | `/api/v1/admin/notifications` | Bearer + Admin | Notification queue with attempts and last error |
| POST | `/api/v1/admin/notifications/process` | Bearer + Admin | Send what is due now |
| POST | `/api/v1/admin/notifications/{id}/retry` | Bearer + Admin | Put a failed message back in the queue |
| GET | `/api/v1/me/notifications` | Bearer | My order messages |
| POST / DELETE | `/api/v1/me/notifications/device-tokens` | Bearer | Register / remove a push token |
| GET | `/api/v1/orders/{id}/invoice` | Bearer | Invoice PDF |
| GET | `/api/v1/orders/{id}/invoice/details` | Bearer | Invoice record as JSON |
| GET | `/api/v1/admin/orders/{id}/invoice` | Bearer + Admin | Download any invoice PDF |

### Error codes introduced

`REPORT_RANGE_INVALID` (400, `from` is after `to`),
`INVOICE_NOT_AVAILABLE` (409), `NOTIFICATION_NOT_RETRYABLE` (409, only a failed message
can be retried).

### Notes for the frontend

* **Dashboard** is one call: `today` (orders, cancelledOrders, salesPaise, byStatus),
  `pendingDeliveries` (count + the soonest orders), `lowStock` (threshold, count, up to 20
  products) and `cashOnDelivery` (orders, outstandingPaise). Send
  `?lowStockThreshold=` if the shop wants a different cut-off than 10.
* **Reports** are real `.xlsx` downloads: use the `Content-Disposition` file name and
  open/save the bytes; do not paste them into a JSON viewer. The period defaults to the
  last 30 days, and amounts in the sheet are rupees, not paise.
* **Invoices**: the PDF is generated per request and safe to open inline. A buyer with a
  GST number gets a TAX INVOICE with both GST numbers; everyone else gets a BILL with no
  GSTIN. `kind` in the JSON tells you which, so you can label the receipt correctly.
* **Notifications** are queued automatically and sent in the background — there is
  nothing to call on checkout. Register a device with the push token on app start so the
  customer also receives push; the token is not a phone number.
  `GET /me/notifications` is the in-app inbox (poll it or refresh on order screens).
  `status: FAILED` messages are ones the provider refused; the shop can retry them.
* **Audit log** entries are `action` (`"PATCH /admin/products/:id/stock"`),
  `entityType`/`entityId`, `actor`, `metadata` (the accepted body), `requestId` and
  `createdAt`. Reads are never logged, so an empty trail means nobody changed anything.

---

## Step 4 - Orders and payments

**Branch:** `step-4-orders-payments`
**Version:** v1.3.0

### Added endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/api/v1/orders` | Bearer | Order history (filter `status`, `paymentStatus`, `from`, `to`) |
| POST | `/api/v1/orders` | Bearer | Checkout, with an optional `Idempotency-Key` header |
| GET | `/api/v1/orders/{id}` | Bearer | One order with its frozen prices and timeline |
| POST | `/api/v1/orders/{id}/cancel` | Bearer | Cancel while CONFIRMED, stock restored |
| POST | `/api/v1/orders/{id}/reorder` | Bearer | One-tap reorder into the cart |
| POST | `/api/v1/orders/{id}/payments/online` | Bearer | Start a Razorpay payment |
| POST | `/api/v1/payments/razorpay/verify` | Bearer | Verify the Razorpay checkout response |
| POST | `/api/v1/payments/razorpay/webhook` | signature | Razorpay webhook (server to server) |
| GET | `/api/v1/admin/orders` | Bearer + Admin | All orders, filters + search |
| GET | `/api/v1/admin/orders/{id}` | Bearer + Admin | Order detail with payments |
| PATCH | `/api/v1/admin/orders/{id}/status` | Bearer + Admin | Next status, logged in the timeline |
| POST | `/api/v1/admin/orders/{id}/cancel` | Bearer + Admin | Cancel any undelivered order |
| POST | `/api/v1/admin/orders/{id}/waive-charge` | Bearer + Admin | Waive one charge on this order |
| POST | `/api/v1/admin/orders/{id}/payments` | Bearer + Admin | Record cash received (COD) |
| GET / POST | `/api/v1/admin/credit-terms` | Bearer + Admin | Contractors with pay-later terms |
| GET / PATCH / DELETE | `/api/v1/admin/credit-terms/{id}` | Bearer + Admin | Change or remove terms |

### Error codes introduced

`CART_EMPTY`, `PRODUCT_UNAVAILABLE`, `INSUFFICIENT_STOCK` (409, with the quantity left),
`DELIVERY_ADDRESS_REQUIRED`, `INVALID_ORDER_STATUS_CHANGE` (409, with `allowedNextStatuses`),
`ORDER_ALREADY_CANCELLED`, `ORDER_NOT_PAYABLE`, `CHARGE_ALREADY_WAIVED`,
`PAYMENT_NOT_CONFIGURED` (503), `PAYMENT_PROVIDER_ERROR` (502),
`PAYMENT_SIGNATURE_INVALID`, `PAYMENT_ALREADY_SETTLED`, `PAYMENT_AMOUNT_INVALID`,
`PAYMENT_NOT_ALLOWED`, `CREDIT_NOT_AVAILABLE` (403), `CREDIT_LIMIT_EXCEEDED`,
`CREDIT_TERMS_EXIST`.

### Notes for the frontend

* **Checkout sends the cart as it is stored on the server.** `POST /orders` takes
  `addressId` (optional - the cart address, then the default address), `deliveryDate`
  (`YYYY-MM-DD`, today or later), `deliverySlot`, `notes` and `paymentMethod`
  (`ONLINE`, `CASH_ON_DELIVERY` or `CREDIT`, default `CASH_ON_DELIVERY`). The response is
  the whole order, and the cart is empty afterwards - no need to refresh it separately.
* **Send an `Idempotency-Key` header** (8-128 characters, for example a UUID) so a double
  tap or a retried request returns the same order. A replay answers `200` with
  `Idempotent-Replayed: true` instead of `201`; show the same success screen either way.
* **Prices, charges and the address are frozen on the order** at checkout. Display them
  from the order, never recompute from the product or the current shop settings.
  `items[].appliedRule` explains the price exactly as it was applied.
* Statuses move one way only: `CONFIRMED` -> `PACKED` -> `OUT_FOR_DELIVERY` -> `DELIVERED`.
  A customer can cancel only while `CONFIRMED`; a delivered order cannot be cancelled.
  `409 INVALID_ORDER_STATUS_CHANGE` carries `details.allowedNextStatuses` for the admin UI.
* `payment.status` is `PENDING`, `PARTIALLY_PAID` or `PAID`; `payment.amountDuePaise` is
  what is still owed. `payment.canPayOnline` is true only for an ONLINE order with an
  amount due.
* **Online payment flow:** `POST /orders/{id}/payments/online` returns
  `{ keyId, razorpayOrderId, amountPaise, currency }`. Open the Razorpay checkout with
  those values, then send `razorpay_order_id`, `razorpay_payment_id` and
  `razorpay_signature` to `POST /payments/razorpay/verify`. Only that call makes the order
  paid - never show "paid" from the client alone. The webhook confirms payments even if
  the app closes before verifying.
* **Cash on delivery:** no payment call at checkout. The shop records the money with
  `POST /admin/orders/{id}/payments` (partial amounts allowed).
* **Pay later:** `CREDIT` at checkout works only for a contractor whose credit terms the
  admin enabled. `403 CREDIT_NOT_AVAILABLE` or `400 CREDIT_LIMIT_EXCEEDED` (with
  `details.availablePaise`) should be shown as a polite notice with "choose another
  payment method".
* `POST /orders/{id}/reorder` returns `{ cart, added, skipped[] }`: items the shop has hidden
  since are skipped and listed, the rest are back in the cart at today's prices.
* The admin order shape adds `customer.id` and `payments[]` (including `signatureVerified`).
  `timeline[]` is the status history, with who changed it and when.
* Waiving a charge changes only that order: `money.waivedCharge` records what was waived and
  `money.grandTotalPaise` already excludes it.

---

## Step 3 - Pricing, cart and delivery charges

**Branch:** `step-3-pricing-cart`
**Version:** v1.2.0

### Added endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/api/v1/cart` | Bearer | Priced cart with every charge as its own line |
| DELETE | `/api/v1/cart` | Bearer | Empty the cart |
| POST | `/api/v1/cart/items` | Bearer | Add a product (adds to the quantity if already there) |
| PATCH | `/api/v1/cart/items/{id}` | Bearer | Set a line's quantity |
| DELETE | `/api/v1/cart/items/{id}` | Bearer | Remove a line |
| PUT | `/api/v1/cart/delivery` | Bearer | Choose (or clear) the delivery address for this cart |
| GET / PATCH | `/api/v1/admin/pricing/settings` | Bearer + Admin | Minimum order, charges, free-delivery rules, shop location |
| GET / POST | `/api/v1/admin/pricing/contractor-prices` | Bearer + Admin | Per-contractor special prices |
| PATCH / DELETE | `/api/v1/admin/pricing/contractor-prices/{id}` | Bearer + Admin | Change or remove one |
| GET / POST | `/api/v1/admin/pricing/bulk-discounts` | Bearer + Admin | Bulk quantity discounts |
| PATCH / DELETE | `/api/v1/admin/pricing/bulk-discounts/{id}` | Bearer + Admin | Change or remove one |
| GET / POST | `/api/v1/admin/pricing/contractor-rules` | Bearer + Admin | Contractor percentage rules |
| PATCH / DELETE | `/api/v1/admin/pricing/contractor-rules/{id}` | Bearer + Admin | Change or remove one |
| GET / POST | `/api/v1/admin/delivery/slabs` | Bearer + Admin | Distance slabs from the shop |
| PATCH / DELETE | `/api/v1/admin/delivery/slabs/{id}` | Bearer + Admin | Change or remove one |
| GET / POST | `/api/v1/admin/delivery/pincodes` | Bearer + Admin | Approved delivery pincodes |
| PATCH / DELETE | `/api/v1/admin/delivery/pincodes/{pincode}` | Bearer + Admin | Change, deactivate or remove one |

### Error codes introduced

`PINCODE_NOT_SERVICEABLE` (400, delivery address outside the approved pincodes),
`OUT_OF_DELIVERY_RANGE` (400, address beyond the last distance slab),
`DELIVERY_SLAB_OVERLAP` (409, a slab that overlaps an active one),
`DUPLICATE_PINCODE` (409, pincode already approved),
`CONTRACTOR_PRICE_EXISTS` (409, that contractor already has a price for that product).

### Notes for the frontend

* **Prices are never cached in the cart.** Every `GET /cart` prices the lines again, so a price
  change or a new rule shows up immediately. Do not store `unitPricePaise` as the truth.
* Pricing order, first match wins (discounts never stack): contractor special price, then bulk
  quantity discount, then contractor percentage rule, then the normal price. Each line returns
  `originalPricePaise`, `unitPricePaise` and `appliedRule`
  (`{ type, id, label }`, type is one of `CONTRACTOR_SPECIAL_PRICE`, `BULK_DISCOUNT`,
  `CONTRACTOR_PERCENTAGE`, `NORMAL_PRICE`). Show the label next to the strike-through original
  price - it is already written for customers ("Your contractor price", "Buy 10 or more - 3% off").
* `charges` is always three lines in a fixed order: `ITEM_TOTAL`, `MIN_ORDER_CHARGE`,
  `DISTANCE_CHARGE`, each `{ code, label, amountPaise, amountToAvoidChargePaise }`. Render them
  under the item total; `grandTotalPaise` already includes all of them.
* `MIN_ORDER_CHARGE.amountToAvoidChargePaise` is what to show as "Add ₹200 more to remove this
  charge". It is `null` when the charge does not apply. `minOrder` repeats the same information
  with the admin's threshold.
* When `requiresDeliveryAddress` is `true` the cart has items but the account has no address:
  ask for one and call `PUT /cart/delivery`, then show the delivery charge. `delivery` is `null`
  in that state and the distance charge is `0`, so the total is not final.
* `delivery` explains the delivery: `{ addressId, pincode, distanceKm, isFreeDelivery,
  freeDeliveryReason }`; `freeDeliveryReason` is `ORDER_ABOVE_AMOUNT` or `WITHIN_RADIUS`. Show
  "Free delivery" with that reason.
* Unapproved pincode -> `400 PINCODE_NOT_SERVICEABLE` (message names the pincode; ask for another
  address). Beyond the last slab -> `400 OUT_OF_DELIVERY_RANGE` with `details.distanceKm`.
  Both are shown as a polite notice, not a generic failure.
* Adding a hidden product, or a product the shop hid after it was added, is not silently
  dropped: the line stays with `isAvailable: false` so the app can warn. `inStock` is still
  returned per line.
* Quantities are whole numbers 1-999; adding a product already in the cart increases the
  quantity. All cart endpoints return the whole cart, so one response refreshes the screen.
* Admin amounts are integer paise and percentages are `discountBps` (basis points, `500` = 5%);
  the admin shapes also return `discountPercent` for display.
* The cart is stored on the server per account, so it survives app restarts, reinstalls and
  device changes.

---

## Step 2 - Product catalogue

**Branch:** `step-2-products`
**Version:** v1.1.0

### Added endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/api/v1/categories` | public | Category tree (top-level categories with sub-categories) |
| GET | `/api/v1/products` | public | Searchable, filterable, paginated product list |
| GET | `/api/v1/products/{id}` | public | Product detail |
| GET | `/api/v1/admin/categories` | Bearer + Admin | Category tree including hidden categories |
| POST | `/api/v1/admin/categories` | Bearer + Admin | Create a category or sub-category |
| PATCH | `/api/v1/admin/categories/{id}` | Bearer + Admin | Rename, reorder or hide a category |
| DELETE | `/api/v1/admin/categories/{id}` | Bearer + Admin | Delete an empty category |
| GET | `/api/v1/admin/products` | Bearer + Admin | All products, including hidden, with stock |
| POST | `/api/v1/admin/products` | Bearer + Admin | Add a product |
| GET | `/api/v1/admin/products/{id}` | Bearer + Admin | Product detail including hidden products |
| PATCH | `/api/v1/admin/products/{id}` | Bearer + Admin | Edit, hide or unhide a product |
| PATCH | `/api/v1/admin/products/{id}/stock` | Bearer + Admin | Set stock absolutely or adjust it |
| POST | `/api/v1/admin/products/import` | Bearer + Admin | Bulk import products from an `.xlsx` file |

### Error codes introduced

`SKU_ALREADY_EXISTS` (409, adding a product with an existing SKU),
`DUPLICATE_CATEGORY` (409, same name or slug at the same level),
`CATEGORY_IN_USE` (409, deleting a category that still has products or sub-categories),
`INVALID_IMPORT_FILE` (400, missing file, not `.xlsx`, unreadable workbook or missing columns).

### Notes for the frontend

* `GET /categories` returns **two levels only**: roots with a `children` array. Render the
  roots in the sidebar and the children inside each. `productCount` covers that category only
  (visible products), so a parent's own count can legitimately be `0`.
* Product units are lowercase strings: `kg`, `bag`, `piece`, `litre`, `box`.
* Prices are integer **paise** (`6850` = ₹68.50). Format with `paise / 100` on the client.
* The public product shape has **no stock number**, only `inStock` (boolean). Show "In stock" /
  "Out of stock"; never show a count on the customer side. The admin shape adds
  `stockQuantity`, `isActive` and `categoryId`.
* Hidden products (`isActive: false`) are absent from every public response; `GET /products/{id}`
  answers `404 NOT_FOUND` for them, same as an unknown id.
* `GET /products` query parameters: `search` (name, brand or SKU), `category` (slug; a parent
  slug includes its sub-categories), `brand`, `minPricePaise`, `maxPricePaise`, `inStock`,
  `sort` (`newest` default, `price_asc`, `price_desc`, `name_asc`), `page`, `limit` (max 100).
  An unknown `category` slug returns an **empty page**, not an error.
* Paginated responses carry `meta: { page, limit, total, totalPages }` - use it to build
  "Load more".
* `PATCH /admin/products/{id}/stock` takes **exactly one** of `stockQuantity` (absolute) or
  `adjustment` (relative, e.g. `-2`); sending both or neither is a `VALIDATION_ERROR`. Stock can
  never go below zero.
* The product SKU cannot be changed after creation, because bulk imports match on it.
* Excel import: send `multipart/form-data` with the file in the field `file` (max 5 MB, first
  sheet, 5000 rows). Prices in the sheet are **rupees**, not paise. The endpoint answers `200`
  with a report (`totalRows`, `created`, `updated`, `failed`, `errors[]`) even when some rows
  fail; `errors[].row` is the spreadsheet row number with the header on row 1, so you can point
  the owner at the exact bad cell. Show the report, not a generic error, whenever you get `200`.
* Only an unreadable file, a wrong extension or missing columns produce `400
  INVALID_IMPORT_FILE`; in that case nothing was imported.

### Changed

* Nothing in Step 1 changed behaviour. `GET /health`, `/docs` and all Step 1 endpoints are
  untouched.

### Deprecated

* Nothing.

---

## Step 1 - Project setup, accounts and login

**Branch:** `step-1-setup-login`
**Version:** v1.0.0 (first API version)

### Added endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/api/v1/auth/otp/request` | public | Send a 6 digit OTP (5 minute expiry, rate limited) |
| POST | `/api/v1/auth/otp/verify` | public | Verify OTP, sign up a new account or log in |
| GET | `/api/v1/auth/me` | Bearer | Current user from the token |
| GET | `/api/v1/me` | Bearer | My profile |
| PATCH | `/api/v1/me` | Bearer | Update name, company name, GST number |
| GET | `/api/v1/me/addresses` | Bearer | List saved delivery addresses |
| POST | `/api/v1/me/addresses` | Bearer | Save a delivery address |
| GET | `/api/v1/me/addresses/{id}` | Bearer | Address detail |
| PATCH | `/api/v1/me/addresses/{id}` | Bearer | Update an address |
| DELETE | `/api/v1/me/addresses/{id}` | Bearer | Delete an address |
| GET | `/api/v1/me/project-sites` | Bearer | List project sites |
| POST | `/api/v1/me/project-sites` | Bearer | Create a project site |
| GET | `/api/v1/me/project-sites/{id}` | Bearer | Project site detail |
| PATCH | `/api/v1/me/project-sites/{id}` | Bearer | Update a project site |
| DELETE | `/api/v1/me/project-sites/{id}` | Bearer | Delete a project site |
| GET | `/api/v1/admin/users` | Bearer + Admin | List/search users (paginated) |
| GET | `/api/v1/admin/users/{id}` | Bearer + Admin | User detail |
| POST | `/api/v1/admin/users/{id}/block` | Bearer + Admin | Block a user (login disabled immediately) |
| POST | `/api/v1/admin/users/{id}/unblock` | Bearer + Admin | Unblock a user |

Also available: `GET /health` (outside `/api/v1`) and interactive docs at `/docs`
with the raw spec at `/docs/openapi.yaml`.

### Response formats

Success:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 } }
```

`meta` is only present on paginated responses. `GET`/`POST`/`PATCH` return `200` or `201`;
`DELETE` returns `204` with an empty body.

Error:

```json
{
  "success": false,
  "error": {
    "code": "OTP_INVALID",
    "message": "Incorrect OTP",
    "details": { "remainingAttempts": 4 }
  },
  "requestId": "5c0c4a3e-9a4a-4f1e-9a0d-1c2b3a4d5e6f"
}
```

`requestId` is also returned in the `X-Request-Id` header on every response. Send your
own `X-Request-Id` header and the API echoes it back, which helps when reporting bugs.

### Error codes introduced

`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `ROUTE_NOT_FOUND`, `NOT_FOUND`,
`INTERNAL_ERROR`, `OTP_RATE_LIMITED`, `OTP_RESEND_TOO_SOON`, `OTP_EXPIRED`,
`OTP_INVALID`, `OTP_MAX_ATTEMPTS`, `ACCOUNT_TYPE_REQUIRED`,
`ACCOUNT_TYPE_NOT_ALLOWED`, `ACCOUNT_TYPE_IMMUTABLE`, `USER_BLOCKED`,
`CANNOT_BLOCK_ADMIN`, `CANNOT_BLOCK_SELF`.

### Notes for the frontend

* Login is phone + OTP only. No password field anywhere.
* `POST /auth/otp/request` returns `isNewUser`. When it is `true`, show the sign-up screen
  and send `accountType` (`CUSTOMER` or `CONTRACTOR`) **and** `name` on verify.
  A 6 digit OTP valid for 5 minutes is required.
* Respect `resendAfterSeconds` before enabling the "Resend OTP" button and handle
  `OTP_RESEND_TOO_SOON` (429) gracefully.
* In development the fixed OTP is `123456` and the request response also contains
  `devOtp`. `devOtp` never appears in production.
* The access token is a JWT. Send `Authorization: Bearer <token>`. Tokens last
  `expiresInSeconds` (30 days by default).
* A blocked account gets `USER_BLOCKED` on 403 - show a "contact the shop" screen and clear
  the stored token. This can happen while the app is open, on any authenticated call.
* `companyName` and `gstNumber` are optional everywhere. Send `null` or `""` to clear them.
* `accountType` is chosen once at sign-up and cannot be changed (`ACCOUNT_TYPE_IMMUTABLE`).
* Errors are always the same envelope, so a single interceptor is enough.
* Money will be integer paise in later steps; nothing in this step deals with money yet.

### Changed

* Nothing - this is the first API version.

### Deprecated

* Nothing.
