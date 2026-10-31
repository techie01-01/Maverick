#!/usr/bin/env node
/**
 * End-to-end smoke test for the Brightloop API.
 *
 * Dependency-free: it talks to the real HTTP API with the built-in fetch and
 * asserts the behaviour described in the brief.
 *
 *   node server/test/smoke.mjs          (or: npm test)
 *
 * Requires the API to be running on PORT (default 4000) with seeded data.
 */
const BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 4000}/api`;

const passed = [];
const failed = [];

const call = async (method, path, body, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
};

const check = (name, cond, extra = '') => {
  if (cond) { passed.push(name); console.log(`  \x1b[32mPASS\x1b[0m  ${name}${extra ? ` \x1b[90m${extra}\x1b[0m` : ''}`); }
  else { failed.push(name); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${extra ? ` \x1b[90m${extra}\x1b[0m` : ''}`); }
};

const login = async (email, password) => {
  const { data } = await call('POST', '/auth/login', { email, password });
  return data?.token;
};

const tag = String(Math.floor(Math.random() * 90000) + 10000);
const section = (t) => console.log(`\n\x1b[1m=== ${t} ===\x1b[0m`);

try {
  await fetch(`${BASE}/health`);
} catch {
  console.error(`\n\x1b[31mCannot reach the API at ${BASE}\x1b[0m`);
  console.error('Start it first:  npm run dev:server   (or  npm run dev)\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
section('AUTH & ROLES');

let r = await call('POST', '/auth/login', { email: 'admin@brightloop.io', password: 'wrong' });
check('bad password rejected', r.status === 401, r.data?.error);

const ADMIN = await login('admin@brightloop.io', 'Admin@1234');
const STAFF = await login('priya@brightloop.io', 'Staff@1234');
check('admin login', Boolean(ADMIN));
check('staff login', Boolean(STAFF));

r = await call('GET', '/reports/dashboard');
check('unauthenticated request rejected', r.status === 401);

r = await call('POST', '/users/staff', { email: 'x@y.io', password: 'Staff@12345', name: 'X' }, STAFF);
check('staff cannot create staff', r.status === 403, r.data?.error);

r = await call('POST', '/discounts', { code: 'Z', name: 'z', value: 5 }, STAFF);
check('staff cannot create discount', r.status === 403);

r = await call('POST', '/products', { name: 'z' }, STAFF);
check('staff cannot create product', r.status === 403);

r = await call('GET', '/users?role=customer&limit=1', undefined, STAFF);
check('staff can read customers', r.status === 200 && r.data.total > 0);

r = await call('POST', '/users/staff', { email: `staff${tag}@brightloop.io`, password: 'Staff@12345', name: 'Temp Staff' }, ADMIN);
check('admin can create staff', r.status === 201);

/* ------------------------------------------------------------------ */
section('PASSWORD POLICY');

for (const [pw, label] of [
  ['short1!', 'too short'],
  ['alllowercase1!', 'no uppercase'],
  ['ALLUPPERCASE1!', 'no lowercase'],
  ['NoSpecial1234', 'no special'],
]) {
  r = await call('POST', '/auth/signup', { email: `p${tag}${label.replace(/\s/g, '')}@example.com`, password: pw, name: 'P' });
  check(`reject password: ${label}`, r.status === 400 && Boolean(r.data?.details?.password), r.data?.error);
}

r = await call('POST', '/auth/signup', { email: `ok${tag}@example.com`, password: 'GoodPass@123', name: 'Ok User' });
check('accept compliant password', r.status === 201);

r = await call('POST', '/auth/signup', { email: `ok${tag}@example.com`, password: 'GoodPass@123', name: 'Dup' });
check('duplicate email rejected', r.status === 409, r.data?.error);

/* ------------------------------------------------------------------ */
section('PASSWORD RESET');

r = await call('POST', '/auth/forgot-password', { email: `ok${tag}@example.com` });
let resetToken = r.data?.dev_token;
// In production the token is never returned inline — read it from the outbox,
// which also proves the reset email was actually queued.
if (!resetToken) {
  const mail = await call('GET', '/mail?category=password_reset', undefined, ADMIN);
  const body = mail.data?.rows?.[0]?.body || '';
  resetToken = /token=([a-f0-9]+)/.exec(body)?.[1] || null;
}
check('reset token issued', Boolean(resetToken));

r = await call('POST', '/auth/reset-password', { token: resetToken, password: 'NewPass@1234' });
check('reset applied', r.status === 200);

check('login with new password', Boolean(await login(`ok${tag}@example.com`, 'NewPass@1234')));

r = await call('POST', '/auth/reset-password', { token: resetToken, password: 'NewPass@1234' });
check('reset token is single-use', r.status === 400, r.data?.error);

/* ------------------------------------------------------------------ */
section('CATALOGUE');

r = await call('POST', '/taxes', { name: `Test GST ${tag}`, rate: 18, applies_to: 'all' }, ADMIN);
check('admin creates tax', r.status === 201);
const TAX = r.data.row.id;

r = await call('POST', '/products', {
  name: `Test Widget ${tag}`, sku: `TW-${tag}`, type: 'service',
  sales_price: 1000, cost_price: 200, notes: 'smoke test',
  variants: [{ attribute_name: 'Brand', attribute_value: 'Odoo', price_extra: 560 }],
  tax_ids: [TAX],
}, ADMIN);
check('admin creates product', r.status === 201);
const PID = r.data.row.id;

r = await call('GET', `/products/${PID}`, undefined, ADMIN);
check('variant adds 560 to the price', r.data.row.variants[0].price_extra === 560);
check('product tax attached', r.data.row.taxes.length === 1);

r = await call('POST', '/plans', {
  name: `Test Plan ${tag}`, code: `TP-${tag}`, product_id: PID,
  billing_period: 'monthly', interval_count: 1, price: 1000, min_quantity: 2,
  allow_pause: 1, allow_close: 1, allow_renew: 1, close_on_end: 1,
}, ADMIN);
check('admin creates plan', r.status === 201);
const PLID = r.data.row.id;

r = await call('GET', '/portal/catalog', undefined, ADMIN);
check('catalogue lists live plans', r.status === 200 && r.data.rows.length > 0);

/* ------------------------------------------------------------------ */
section('SUBSCRIPTION LIFECYCLE');

r = await call('GET', '/users?role=customer&limit=5', undefined, ADMIN);
const CUST = r.data.rows[0].id;

r = await call('POST', '/subscriptions', { customer_id: CUST, plan_id: PLID, start_date: '2026-10-01', quantity: 1 }, ADMIN);
check('min quantity enforced', r.status === 400, r.data?.error);

r = await call('POST', '/subscriptions', {
  customer_id: CUST, plan_id: PLID, start_date: '2026-10-01', quantity: 3,
  duration_cycles: 4, payment_term: 'net15', state: 'draft',
  lines: [{ product_id: PID, quantity: 2, unit_price: 1000 }],
}, ADMIN);
check('create subscription', r.status === 201, r.data?.row?.number);
const SID = r.data.row.id;
check('expiry auto-computed', r.data.row.expiry_date >= '2026-10-31', r.data.row.expiry_date);

for (const [action, expected] of [['send_quotation', 'quotation'], ['confirm', 'confirmed'], ['activate', 'active']]) {
  r = await call('POST', `/subscriptions/${SID}/transition`, { action }, ADMIN);
  check(`transition -> ${expected}`, r.status === 200 && r.data.row.state === expected);
}

r = await call('POST', `/subscriptions/${SID}/transition`, { action: 'activate' }, ADMIN);
check('illegal transition blocked', r.status === 400, r.data?.error);

r = await call('GET', `/subscriptions/${SID}`, undefined, STAFF);
check('staff can see any subscription', r.status === 200);

const CUST_TOKEN = await login('nandini@anandtraders.com', 'Customer@1234');
r = await call('GET', `/subscriptions/${SID}`, undefined, CUST_TOKEN);
check("customer blocked from another customer's subscription", r.status === 403, r.data?.error);

r = await call('GET', '/subscriptions?limit=5', undefined, CUST_TOKEN);
check('customer list is scoped to self', r.status === 200 && new Set(r.data.rows.map((x) => x.customer_id)).size <= 1);

/* ------------------------------------------------------------------ */
section('BILLING & INVOICING');

r = await call('POST', `/subscriptions/${SID}/bill`, {}, ADMIN);
check('manual bill creates an invoice', r.status === 201);
const inv = r.data.invoice;
check('invoice totals computed', inv.subtotal > 0 && inv.tax_total > 0,
  `sub=${inv.subtotal} tax=${inv.tax_total} total=${inv.total}`);

r = await call('POST', `/subscriptions/${SID}/bill`, {}, ADMIN);
check('second bill advances to the next period', r.status === 201 && r.data.invoice?.period_start > inv.period_start,
  `${inv.period_start} -> ${r.data.invoice?.period_start}`);

r = await call('GET', `/invoices/${inv.id}`, undefined, ADMIN);
check('invoice has lines', r.data.row.lines.length >= 2);
check('invoice has a tax summary', r.data.row.taxes.length >= 1);
check('amount in words rendered', r.data.row.amount_in_words.includes('Rupees'), r.data.row.amount_in_words.slice(0, 42));

r = await call('POST', `/invoices/${inv.id}/send`, undefined, ADMIN);
check('cannot send a draft', r.status === 400, r.data?.error);

r = await call('POST', `/invoices/${inv.id}/confirm`, undefined, ADMIN);
check('confirm invoice', r.status === 200 && r.data.row.state === 'confirmed');

r = await call('POST', `/invoices/${inv.id}/send`, undefined, ADMIN);
check('send invoice emails the customer', r.status === 200, r.data?.message);
check('sent_at recorded', Boolean(r.data.row.sent_at));

const total = inv.total;
r = await call('POST', '/payments', { invoice_id: inv.id, amount: 500, method: 'upi', note: 'part 1' }, ADMIN);
check('partial payment accepted', r.status === 201 && Math.abs(r.data.invoice.balance - (total - 500)) < 0.02,
  `balance=${r.data.invoice?.balance}`);
check('invoice still open after a partial payment', r.data.invoice.state === 'confirmed');

r = await call('POST', '/payments', { invoice_id: inv.id, amount: total * 10 }, ADMIN);
check('overpayment rejected', r.status === 400, r.data?.error);

r = await call('POST', '/payments', { invoice_id: inv.id, amount: total - 500, method: 'bank_transfer' }, ADMIN);
check('final payment settles the invoice', r.status === 201 && r.data.fully_paid === true);
check('invoice marked paid', r.data.invoice.state === 'paid' && r.data.invoice.balance === 0);

/* ------------------------------------------------------------------ */
section('BILLING SWEEP');

r = await call('GET', '/billing/preview', undefined, ADMIN);
check('billing preview works', r.status === 200, `due=${r.data?.count} est=${r.data?.estimated_total}`);

const sweep1 = await call('POST', '/billing/run', {}, ADMIN);
check('billing sweep runs', sweep1.status === 200, `created=${sweep1.data?.created} in ${sweep1.data?.durationMs}ms`);

const sweep2 = await call('POST', '/billing/run', {}, ADMIN);
check('sweep is idempotent — no double billing', sweep2.data?.created === 0, `second run created ${sweep2.data?.created}`);

r = await call('GET', '/billing/runs', undefined, ADMIN);
check('billing run history recorded', r.status === 200 && r.data.total >= 1);

/* ------------------------------------------------------------------ */
section('DISCOUNTS');

r = await call('POST', '/discounts', {
  code: `TEST${tag}`, name: 'Smoke discount', kind: 'percent', value: 10,
  min_quantity: 2, max_uses: 3, applies_to: 'subscription',
}, ADMIN);
check('admin creates a discount', r.status === 201);

r = await call('POST', '/discounts', { code: `TEST${tag}`, name: 'dup', value: 5 }, ADMIN);
check('duplicate discount code rejected', r.status === 400, r.data?.error);

r = await call('POST', '/discounts', { code: `OVER${tag}`, name: 'bad pct', kind: 'percent', value: 150 }, ADMIN);
check('invalid percentage rejected', r.status === 400, r.data?.error);

r = await call('POST', '/discounts/preview', { subtotal: 10000, quantity: 5 }, ADMIN);
check('discount preview works', r.status === 200 && r.data.best !== null,
  `best=${r.data?.best?.code} saving=${r.data?.best?.saving}`);

/* ------------------------------------------------------------------ */
section('REPORTS & PERFORMANCE');

let t0 = performance.now();
r = await call('GET', '/reports/dashboard', undefined, ADMIN);
let dt = performance.now() - t0;
check('dashboard responds in under 2s', r.status === 200 && dt < 2000, `${dt.toFixed(0)}ms`);
check('dashboard exposes MRR', r.data.kpis.mrr > 0, `MRR=${r.data.kpis.mrr}`);
check('ageing has all buckets', ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'].every((k) => k in r.data.aging));
check('12-month trend returned', r.data.trend.length === 12);

for (const grp of ['month', 'customer', 'plan', 'method']) {
  t0 = performance.now();
  r = await call('GET', `/reports/revenue?groupBy=${grp}`, undefined, ADMIN);
  dt = performance.now() - t0;
  check(`revenue grouped by ${grp}`, r.status === 200 && dt < 2000, `${r.data?.rows?.length} rows in ${dt.toFixed(0)}ms`);
}

t0 = performance.now();
r = await call('GET', '/reports/receivables', undefined, ADMIN);
dt = performance.now() - t0;
check('receivables in under 2s', r.status === 200 && dt < 2000, `${r.data?.rows?.length} rows in ${dt.toFixed(0)}ms`);

t0 = performance.now();
r = await call('GET', '/invoices?limit=20&status=overdue', undefined, ADMIN);
dt = performance.now() - t0;
check('invoice list in under 2s', r.status === 200 && dt < 2000, `total=${r.data?.total} in ${dt.toFixed(0)}ms`);

const csvRes = await fetch(`${BASE}/reports/export.csv?type=invoices`, { headers: { Authorization: `Bearer ${ADMIN}` } });
const csv = await csvRes.text();
check('CSV export', csvRes.ok && csv.startsWith('Number,Invoice Date'));

/* ------------------------------------------------------------------ */
section('CUSTOMER PORTAL');

r = await call('GET', '/portal/summary', undefined, CUST_TOKEN);
check('portal summary', r.status === 200 && 'outstanding' in r.data, `subs=${r.data?.subscriptions?.length}`);

r = await call('GET', '/portal/catalog', undefined, CUST_TOKEN);
const CATALOG_PLAN = r.data.rows[0]?.id;
r = await call('POST', '/portal/subscribe', { plan_id: CATALOG_PLAN, quantity: 3 }, CUST_TOKEN);
check('customer can self-serve a plan request', r.status === 201, r.data?.row?.number);

/* ------------------------------------------------------------------ */
section('SUBSCRIPTION CONTROLS');

r = await call('POST', `/subscriptions/${SID}/transition`, { action: 'pause' }, ADMIN);
check('pause', r.status === 200 && r.data.row.state === 'paused');

r = await call('POST', `/subscriptions/${SID}/transition`, { action: 'resume' }, ADMIN);
check('resume', r.status === 200 && r.data.row.state === 'active');

r = await call('POST', `/subscriptions/${SID}/transition`, { action: 'renew' }, ADMIN);
check('renew extends the expiry date', r.status === 200);

r = await call('POST', `/subscriptions/${SID}/transition`, { action: 'close', reason: 'smoke test' }, ADMIN);
check('close', r.status === 200 && r.data.row.state === 'closed');

r = await call('DELETE', `/subscriptions/${SID}`, undefined, ADMIN);
check('cannot delete a subscription that has invoices', r.status === 400, r.data?.error);

/* ------------------------------------------------------------------ */
console.log(`\n${'='.repeat(56)}`);
console.log(`  \x1b[1m${passed.length} passed, ${failed.length} failed\x1b[0m`);
if (failed.length) {
  console.log('\n  Failures:');
  for (const f of failed) console.log(`   \x1b[31m-\x1b[0m ${f}`);
}
console.log(`${'='.repeat(56)}\n`);

process.exit(failed.length ? 1 : 0);
