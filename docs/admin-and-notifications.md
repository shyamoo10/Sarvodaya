# Admin tools, notifications and invoices

How Step 5 behaves, in more detail than the README needs.

## Dashboard

`GET /admin/dashboard` answers the owner's first question every morning:

* **Today**: how many orders came in (cancelled ones counted separately), what they are
  worth, and how they are spread across statuses.
* **Pending deliveries**: every order that is confirmed, packed or out for delivery,
  soonest requested delivery first.
* **Low stock**: products at or below `lowStockThreshold` (default 10), lowest first.
  The threshold is a query parameter, not a constant in code.
* **Cash on delivery outstanding**: how many COD orders still owe money and how much
  in total.

Nothing is cached; every call reads the database, so a delivered order disappears from
the pending list immediately.

## Lists of customers and contractors

`GET /admin/customers` and `GET /admin/contractors` return one page of accounts with
what the shop actually needs: number of (non-cancelled) orders, total purchases, amount
paid, when they last ordered, and — for contractors — the credit limit, payment term and
outstanding pay-later balance. Both support `search` (name, phone, company) and
`isBlocked`.

## Excel reports

Two downloads, both `.xlsx`:

* `GET /admin/reports/sales.xlsx` — one row per order with item total, each charge, the
  waived amount, grand total, paid and due, plus a **Summary** sheet with the period and
  totals. Amounts are rupees in the sheet (the API itself is always paise).
* `GET /admin/reports/orders.xlsx` — one row per item sold: order, date, customer, SKU,
  product, quantity, unit, rate, amount and the price rule that was applied.

The period defaults to the last 30 days; `from` and `to` filter it, and `from` after `to`
answers `400 REPORT_RANGE_INVALID`. Status and payment status can be filtered too.

## Audit log

Every successful admin write — product edits and stock changes, categories, pricing
settings, discounts, slabs, pincodes, order status changes, cancellations, charge
waivers, recorded payments, credit terms, user block/unblock and notification retries —
is appended to the audit log with:

* the admin (id, name and phone at the time),
* the action, as `METHOD /path` (for example `PATCH /admin/products/:id/stock`),
* the record it touched (`entityType` + `entityId`),
* the request body that was accepted, the IP and the request id.

Reads and failed changes are not logged. `GET /admin/audit-logs` filters by actor,
record, action and date. Rows are never edited or deleted.

## Notifications

The customer is messaged at four moments:

| Event | When it is queued | Message |
| --- | --- | --- |
| `ORDER_PLACED` | Checkout succeeds | order number and amount |
| `ORDER_CONFIRMED` | Admin moves the order to `PACKED` | the order is being packed |
| `ORDER_DISPATCHED` | Admin moves it to `OUT_FOR_DELIVERY` | on the way, with the slot if given |
| `ORDER_DELIVERED` | Admin moves it to `DELIVERED` | delivered, thank you |

Each event is queued for every channel in `NOTIFICATION_CHANNELS` (`PUSH`, `SMS`,
`WHATSAPP`). Push is queued only when the account has a registered device
(`POST /me/notifications/device-tokens`).

**The queue is the database.** A `Notification` row is written in the request that
triggers it, and a background worker in the API process claims due rows with
`FOR UPDATE SKIP LOCKED`, sends them, and marks them `SENT`. A failure is retried with an
exponential backoff (`NOTIFICATION_RETRY_BASE_SECONDS`, 60 s doubling) up to
`NOTIFICATION_MAX_ATTEMPTS` times and then marked `FAILED` with the reason kept on the
row. Several API instances can run the worker side by side without sending twice, and
restarting the API never loses a queued message.

A notification problem never fails an order: checkout and status changes are committed
first, and the queue write is best effort.

Admins can see the queue with `GET /admin/notifications` (filter by status, channel,
event or customer), force a run with `POST /admin/notifications/process`, and put a
failed message back in the queue with `POST /admin/notifications/{id}/retry`.

**Delivery providers.** Push, SMS and WhatsApp sit behind one `NotificationProvider`
interface, like the OTP SMS stub from Step 1. Without a provider key the message is
logged instead of sent, so development never messages a real customer. With a key set
but no integration the attempt fails loudly and is retried — deliberately better than
pretending the customer was told. Connecting a real provider means implementing that
interface; no queue, route or database change is needed.

The dedupe key is `orderId:event:channel`, so re-running a status change or a webhook
cannot message the same customer twice about the same moment.

## Invoices

Every order gets an invoice in the same transaction that creates the order, so a sale
can never exist without one. The number comes from its own counter
(`SAR-INV-000001`, prefix from `INVOICE_PREFIX`).

* The buyer gave a GST number → **TAX INVOICE**, with the buyer's GSTIN printed and the
  shop's GSTIN when `SHOP_GST_NUMBER` is set.
* No GST number → **BILL**, with no GSTIN anywhere on it.

Amounts are the order's frozen totals: item total, minimum order charge, delivery charge
and the grand total, each on its own line, plus any waived charge. This API does not
invent tax rates or split CGST/SGST — that is the shop's accountant's call; the invoice
records exactly what the buyer was charged.

`GET /orders/{id}/invoice` returns the PDF (the buyer or the admin),
`GET /admin/orders/{id}/invoice` downloads it as an attachment, and
`GET /orders/{id}/invoice/details` returns the record as JSON for apps that draw their
own receipt screen.
