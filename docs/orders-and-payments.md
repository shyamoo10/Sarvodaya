# Orders, payments and credit

How Step 4 behaves, in more detail than the README needs.

## Checkout

`POST /orders` checks the stored cart, prices it exactly as `GET /cart` does, and copies the
prices, charges, applied rules and delivery address onto the order. The order, its lines, its
status history, the stock reduction and clearing the cart happen in **one database transaction**.
Stock is reduced with a conditional `UPDATE ... WHERE stockQuantity >= quantity`, so when two
buyers reach the last bag of cement at the same time exactly one order succeeds and the other gets
`409 INSUFFICIENT_STOCK` with the quantity that is left.

Send an `Idempotency-Key` header on checkout to make a retry safe: the same key returns the same
order (with `Idempotent-Replayed: true`) instead of placing a second one. Order numbers come from a
counter row, so they are human-friendly and unique (`SAR-000042`).

Delivery needs an approved pincode and an address inside the distance slabs, exactly like the cart;
a checkout with no address answers `DELIVERY_ADDRESS_REQUIRED` rather than guessing.

## Statuses

Statuses only move forward and only the admin moves them:

```
CONFIRMED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED
        \___________\____________\_____> CANCELLED (restores stock)
```

Every change, including who made it and any note, is appended to the order timeline. A customer can
cancel while the order is still `CONFIRMED`; the admin can cancel anything not yet delivered.
Cancelling restores each item's stock exactly once and is refused the second time.

## Payments

Payments are chosen at checkout:

| Method | How it works |
| --- | --- |
| `ONLINE` | `POST /orders/{id}/payments/online` creates a Razorpay order and returns the public key id; the app opens the Razorpay checkout. The payment only counts after `POST /payments/razorpay/verify` checks the HMAC signature, or after a signed webhook. |
| `CASH_ON_DELIVERY` | The order starts unpaid; the admin records cash with `POST /admin/orders/{id}/payments`, in part or in full. Available for every order size. |
| `CREDIT` | Pay later on the terms the admin gives a contractor (`/admin/credit-terms`): an optional credit limit and a payment term in days. Refused with `CREDIT_NOT_AVAILABLE` or `CREDIT_LIMIT_EXCEEDED` otherwise. |

A payment is only ever written by the server: the Razorpay key secret signs the check, the webhook
is verified over the raw body, and the webhook handler is idempotent, so a repeated delivery changes
nothing. `order.paymentStatus` is `PENDING`, `PARTIALLY_PAID` or `PAID`, derived from the successful
payments, and `amountDuePaise` is always the rest.

Without `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` the online endpoints answer
`503 PAYMENT_NOT_CONFIGURED`; cash on delivery and credit keep working. The webhook endpoint stays
closed until `RAZORPAY_WEBHOOK_SECRET` is set.

## Credit terms

Credit terms are ordinary data: the admin creates them for one contractor, can switch them off at
any time, and the API refuses a credit checkout that would take the contractor past the limit. The
outstanding balance is shown next to the terms and counts every unpaid, non-cancelled credit order.

## Admin controls on one order

* `PATCH /admin/orders/{id}/status` moves the order forward and writes the history entry.
* `POST /admin/orders/{id}/waive-charge` waives the minimum order charge or the delivery charge on
  that order only; the shop settings are untouched and one waiver per order is allowed.
* `POST /admin/orders/{id}/payments` records money received, for cash on delivery or a credit
  payment, partly or fully.
* `GET /admin/orders` lists every order with filters for status, payment status, payment method,
  customer and date, and search by order number, phone or name.
