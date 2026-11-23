# API changelog

All changes the frontend developer needs to know about, newest first.
Every pull request updates this file.

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
