# Brightloop API reference

Base URL `http://localhost:4000/api` · JSON in, JSON out.

Authenticate with `Authorization: Bearer <jwt>` on every call except signup, login and the
password-reset endpoints.

Errors always look like this:

```json
{ "error": "This plan requires a minimum quantity of 3." }
```

Validation failures may add a `details` object, e.g.
`{ "error": "Password does not meet the policy.", "details": { "password": ["…"] } }`.

| Status | Meaning |
| --- | --- |
| 400 | Validation failed / illegal action for the current state |
| 401 | Missing or expired token |
| 403 | Authenticated but the role is not allowed |
| 404 | Record not found |
| 409 | Duplicate (email already registered) |
| 429 | Too many auth attempts — wait a minute |

---

## Auth

### `POST /auth/signup`

```json
{ "email": "ops@acme.com", "password": "GoodPass@123", "name": "Asha Rao", "company_name": "Acme" }
```

Password must be **>8 characters with an uppercase, a lowercase and a special character**.
The very first account in an empty database becomes `admin`; every later signup is `customer`.

`201` → `{ "token": "...", "user": { … } }`

### `POST /auth/login`

```json
{ "email": "admin@brightloop.io", "password": "Admin@1234" }
```
`200` → `{ "token": "...", "user": { "id": 1, "role": "admin", … } }`

### `GET /auth/me`
`200` → `{ "user": { … }, "settings": { "currency_symbol": "₹", … } }`

### `POST /auth/forgot-password`
```json
{ "email": "ops@acme.com" }
```
Always returns `200` with a generic message (no account enumeration). In non-production the
response also contains `dev_token` and `dev_link`; the message is written to the Email log
either way.

### `POST /auth/reset-password`
```json
{ "token": "<from the link>", "password": "NewPass@1234" }
```
Tokens are single-use and expire after 60 minutes.

### `POST /auth/change-password`
```json
{ "current_password": "Admin@1234", "new_password": "Better@12345" }
```

---

## Users

### `GET /users`
Query: `role` (`admin|staff|customer`), `q`, `active`, `page`, `limit`.
`200` → `{ rows, total, page, limit, pages }`

Each row carries `active_subs`, `lifetime_invoiced` and `outstanding`.

### `POST /users/staff` — **admin only**
```json
{ "email": "new@brightloop.io", "password": "Staff@12345", "name": "New Person", "phone": "+91…" }
```

### `PATCH /users/:id`
Customers may edit their own profile (`name`, `phone`, `address`, `city`, `country`,
`company_name`, `tax_id`). An admin may additionally set `role` and `is_active`.

---

## Catalogue

### Products

`GET /products?q=&type=&active=&page=` → `{ rows, total, … }`; each row includes
`variants[]`, `variant_count`, `plan_count`, `tax_names`.

`POST /products` (**admin**)
```json
{
  "name": "Brightloop Business Suite",
  "sku": "BLS-SUITE",
  "type": "service",
  "sales_price": 4500,
  "cost_price": 1200,
  "notes": "Core ERP workspace",
  "variants": [{ "attribute_name": "Brand", "attribute_value": "Odoo", "price_extra": 560 }],
  "tax_ids": [1]
}
```

`GET /products/:id` adds `variants[]`, `taxes[]` and `plans[]`.
`PATCH /products/:id` accepts the same fields; sending `variants` or `tax_ids` replaces them.
`DELETE /products/:id` is refused if a plan uses the product — archive it instead.

### Taxes

`GET /taxes` · `POST /taxes` · `PATCH /taxes/:id` · `DELETE /taxes/:id` (**admin**)

```json
{ "name": "GST 18%", "code": "GST18", "rate": 18, "kind": "percent", "applies_to": "all" }
```

`kind`: `percent` (uses `rate`) or `fixed` (uses `fixed_amount`).
`applies_to`: `all | service | goods | digital`.

### Plans

`GET /plans` → rows include `product_name`, `active_subs`.

`POST /plans` (**admin**)
```json
{
  "name": "Growth Monthly", "code": "GROWTH-M", "product_id": 1,
  "billing_period": "monthly", "interval_count": 1, "price": 8500, "min_quantity": 3,
  "available_from": "2025-01-01", "available_to": null,
  "allow_pause": 1, "allow_close": 1, "allow_renew": 1, "close_on_end": 0,
  "max_renewals": 0, "trial_days": 0
}
```

`billing_period`: `daily | weekly | monthly | yearly`. `interval_count > 1` turns monthly into
quarterly, for example. `max_renewals: 0` means unlimited.

### Quotation templates

`GET /quotation-templates` → rows with `lines[]`.

`POST /quotation-templates` (**admin**)
```json
{
  "name": "Enterprise Bundle", "plan_id": 3, "validity_days": 45,
  "payment_term": "net45", "quantity": 10,
  "lines": [{ "product_id": 7, "label": "Onboarding", "quantity": 1, "unit_price": 25000 }]
}
```

---

## Subscriptions

### `GET /subscriptions`
Query: `state` (comma-separated), `q`, `plan_id`, `customer_id`, `due=true`, `page`, `limit`.

```json
{
  "rows": [{
    "id": 12, "number": "SUB-2026-0012", "state": "active",
    "customer_name": "Divya Nair", "company_name": "Coastal Foods Pvt Ltd",
    "plan_name": "Enterprise Yearly", "billing_period": "yearly", "interval_count": 1,
    "quantity": 20, "unit_price": 128000, "mrr": 213333.33,
    "next_billing_date": "2026-11-26", "expiry_date": "2027-09-27", "outstanding": 0
  }],
  "total": 58, "page": 1, "pages": 3,
  "summary": { "active": 38, "paused": 4, "draft": 6, "quotation": 2, "confirmed": 2, "closed": 6 }
}
```

### `POST /subscriptions` (staff)
```json
{
  "customer_id": 5, "plan_id": 2, "start_date": "2026-11-01",
  "quantity": 3, "payment_term": "net30", "duration_cycles": 1,
  "state": "draft", "template_id": null, "notes": "…",
  "lines": [{ "product_id": 4, "quantity": 2, "unit_price": 950 }]
}
```

The plan line is added automatically. `expiry_date` is derived from
`start_date + duration_cycles × interval` unless supplied.

**Rejections:** quantity below `min_quantity`; start date outside the plan's availability
window; archived plan; unknown customer.

### `POST /subscriptions/:id/transition` (staff)

```json
{ "action": "pause" }
```

| Action | Allowed from | Result |
| --- | --- | --- |
| `send_quotation` | draft | → quotation, sets `quotation_valid_until` (+30 days) |
| `confirm` | draft, quotation | → confirmed |
| `activate` | confirmed | → active, sets `next_billing_date` to today or the start date |
| `pause` | active | → paused (requires `plan.allow_pause`) |
| `resume` | paused | → active, billing restarts **from today** |
| `renew` | active | extends `expiry_date` by one cycle (respects `max_renewals`) |
| `close` | active, paused | → closed (requires `plan.allow_close`) |
| `cancel` | draft, quotation, confirmed | → cancelled |

Anything else returns `400` explaining why, e.g.
`"pause" is not allowed while the subscription is paused.`

### `POST /subscriptions/:id/bill` (staff)
Bills the current period immediately and advances `next_billing_date`.
Returns `201 { invoice }`; `400` if the period is already invoiced or the term has lapsed.

---

## Invoices

### `GET /invoices`
Query: `state`, `status` (`outstanding | overdue | paid`), `q`, `customer_id`,
`subscription_id`, `from`, `to`, `sort`, `dir`, `page`, `limit`.

Response adds `summary`:
```json
{ "draft_count": 5, "open_count": 71, "paid_count": 540,
  "outstanding": 1285372.55, "overdue": 1048620.72, "billed": 41298546.10 }
```
and each row carries `is_overdue`.

### `GET /invoices/:id`
Returns the full document: `lines[]` (with `discount_amount`, `tax_rate`, `tax_amount`),
`taxes[]` (per-rate summary), `payments[]`, `company` (invoice header details) and
`amount_in_words` ("Five Thousand Three Hundred Ten Rupees Only").

### Lifecycle
| Endpoint | From | To |
| --- | --- | --- |
| `POST /invoices/:id/confirm` | draft | confirmed |
| `POST /invoices/:id/send` | confirmed, paid | queued email + `sent_at` |
| `POST /invoices/:id/cancel` | draft, confirmed | cancelled (refused if payments exist) |
| `DELETE /invoices/:id` | draft only | deleted |
| `POST /invoices/batch/confirm` | — | `{ "ids": [1,2,3] }` or all drafts |

### `POST /invoices` — one-off invoice (staff)
```json
{
  "customer_id": 5, "invoice_date": "2026-10-31", "payment_term": "net15",
  "lines": [{ "description": "Extra training day", "quantity": 2, "unit_price": 12000, "tax_rate": 18 }]
}
```

---

## Payments

### `GET /payments`
Query: `method`, `from`, `to`, `q`, `page`, `limit`. Response includes
`summary.total`, `summary.c` and `summary.byMethod[]`.

### `POST /payments` (staff)
```json
{ "invoice_id": 42, "amount": 5000, "method": "upi", "payment_date": "2026-10-31",
  "reference": "UPI-88213", "note": "Part payment" }
```

`201` →
```json
{ "row": { … }, "invoice": { "state": "paid", "balance": 0, … }, "fully_paid": true }
```

**Rejected:** amount ≤ 0, amount greater than the outstanding balance, draft/cancelled/paid
invoices.

### `DELETE /payments/:id` — **admin only**
Reverses the payment and restores the invoice balance and state.

### `GET /payments/methods`
`{ "rows": [{ "id": "bank_transfer", "label": "Bank transfer" }, …] }`

---

## Discounts

### `GET /discounts` (staff)
Each rule is decorated with a derived `status` — `live`, `scheduled`, `expired`, `exhausted`
or `inactive` — plus `products[]`, `usage_amount` and `used_count`.

```json
{ "rows": [ … ],
  "summary": { "total": 4, "live": 2, "expired": 1, "exhausted": 1, "saving": 797500 } }
```

### `POST /discounts` — **admin only**
```json
{
  "code": "VOLUME10", "name": "Volume discount — 10 seats or more",
  "kind": "percent", "value": 10,
  "min_purchase": 0, "min_quantity": 10,
  "start_date": "2026-07-03", "end_date": "2027-06-28",
  "max_uses": 50, "applies_to": "subscription",
  "product_ids": [], "scope_note": "Approved by finance"
}
```

`kind`: `percent | fixed`. `applies_to`: `subscription | products` (the latter requires at
least one `product_ids` entry). `max_uses: 0` means unlimited.

### `POST /discounts/preview` (staff)
```json
{ "subtotal": 25000, "quantity": 12, "as_of": "2026-10-31", "product_ids": [] }
```
`200` →
```json
{ "rows": [{ "code": "VOLUME10", "qualifies": true, "saving": 2500 }, …],
  "best": { "code": "VOLUME10", "saving": 2500 } }
```

---

## Billing

### `GET /billing/preview?as_of=2026-10-31` (staff)
```json
{
  "as_of": "2026-10-31",
  "count": 3, "estimated_total": 42500, "already_billed": 0,
  "rows": [{
    "number": "SUB-2026-0031", "customer_name": "…", "plan_name": "Daily Ops Meter",
    "next_billing_date": "2026-10-23", "period_end": "2026-10-23",
    "term_ended": 0, "action": "bill", "estimated_amount": 250
  }]
}
```

`term_ended: 1` means the contract has already lapsed — the sweep will `renew` or `close`
it instead of invoicing.

### `POST /billing/run` (staff)
```json
{ "as_of": "2026-10-31" }
```
```json
{
  "runId": 12, "asOf": "2026-10-31",
  "swept": 3, "created": 3, "skipped": 0,
  "totalAmount": 42500, "durationMs": 41,
  "detail": [{ "subscription": "SUB-2026-0031", "action": "skipped", "reason": "already-billed" }],
  "invoices": [ … ]
}
```

Running it twice in a row returns `"created": 0` — the period guard prevents double billing.

### `GET /billing/health`
```json
{ "stale_backlog": 1, "due_today": 0, "expiring_in_30_days": 3, "last_run": { … } }
```

### `GET /billing/upcoming?days=45`
The renewals radar: every subscription billing inside the window, with its expected amount.

### `GET /billing/runs?page=1` · `GET /billing/runs/:id`
History of every sweep, manual or scheduled.

---

## Reports

### `GET /reports/dashboard?as_of=2026-10-31`
```json
{
  "kpis": {
    "mrr": 1270416.67, "arr": 15244999.96,
    "active_subscriptions": 38, "total_subscriptions": 58,
    "draft_subscriptions": 6, "quotation_subscriptions": 4, "paused_subscriptions": 4,
    "invoiced_this_month": 3482064.0, "collected_this_month": 1980213.5,
    "invoiced_change_pct": 12.4, "collected_change_pct": -21.6,
    "outstanding": 1285372.55, "open_invoices": 71,
    "overdue_count": 18, "overdue_amount": 1048620.72, "draft_invoices": 5,
    "new_subscriptions_this_month": 7, "closed_this_month": 1,
    "churn_rate": 2.6, "avg_revenue_per_account": 33431.0
  },
  "states": { "active": 38, … },
  "trend":  [{ "month": "2026-09", "label": "Sep 26", "invoiced": 0, "collected": 0, "invoices": 0 }, …],
  "aging":  { "current": 0, "d1_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 0 },
  "top_customers": [ … ], "plan_mix": [ … ], "method_mix": [ … ]
}
```

`trend` always contains 12 entries, oldest first.

### `GET /reports/revenue?from=&to=&groupBy=`
`groupBy=month` (default) | `customer` | `plan` | `method`.

### `GET /reports/receivables`
Open invoices with `days_overdue` and a `bucket`
(`current | 1-30 | 31-60 | 61-90 | 90+`).

### `GET /reports/subscriptions`
`by_period[]` (count + MRR per cadence), `renewals[]`, `expiring[]`.

### `GET /reports/export.csv?type=invoices|payments|subscriptions&from=&to=`
`text/csv` download.

---

## Settings, operations and portal

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/settings` | Any signed-in user |
| PUT | `/settings` | **Admin** — company profile, currency, prefixes, scheduler toggle |
| GET | `/mail?category=&page=` | The Email log (invoice, payment_receipt, password_reset, welcome) |
| GET | `/mail/:id` | Full message body |
| GET | `/activity?page=` | Audit trail of everything that changed |
| GET | `/search?q=` | ⌘K search across subscriptions, invoices and customers |
| GET | `/portal/catalog` | Live plans a customer can request |
| POST | `/portal/subscribe` | `{ "plan_id": 2, "quantity": 3, "start_date": "2026-11-01" }` → creates a **quotation** |
| GET | `/portal/summary` | The customer's home: subscriptions, invoices, outstanding, upcoming |

---

## Health

`GET /health` (no auth)

```json
{ "ok": true, "service": "brightloop-sms", "time": "2026-10-31T04:48:31.144Z",
  "database": "sqlite", "counts": { "users": 28, "subscriptions": 58, "invoices": 623 } }
```
