# API changelog

All changes the frontend developer needs to know about, newest first.
Every pull request updates this file.

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
