/**
 * Brightloop demo seed.
 *
 *   npm run seed          → seeds only if the database is empty
 *   npm run reset         → wipes data and reseeds from scratch
 *
 * Produces a year of realistic billing history so every report, chart and
 * filter has something meaningful to show on first login.
 */
import dayjs from 'dayjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, migrate, syncCounters } from './db.js';
import { hashPassword } from './lib/auth.js';
import { addCycle, round2, today } from './lib/util.js';
import { buildInvoiceForSubscription } from './lib/billing.js';

const force = process.argv.includes('--force');
migrate();
const already = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (already > 0 && !force) {
  console.log('Database already has data — nothing to do. Use "npm run reset" to start over.');
  process.exit(0);
}

if (force) {
  console.log('Wiping existing data…');
  db.pragma('foreign_keys = OFF');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM "${t.name}"`).run();
    db.prepare("DELETE FROM sqlite_sequence").run?.();
  })();
  db.pragma('foreign_keys = ON');
}

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-random so the demo looks the same every time   */
/* ------------------------------------------------------------------ */
let seedState = 20260214;
const rand = () => {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randDate = (fromDaysAgo, toDaysAgo = 0) => {
  const days = randInt(toDaysAgo, fromDaysAgo);
  return dayjs().subtract(days, 'day').format('YYYY-MM-DD');
};

const T = today();
console.log('Seeding Brightloop…');

/* ================================================================== */
/* 1. People                                                           */
/* ================================================================== */
const insUser = db.prepare(
  `INSERT INTO users (email, password_hash, name, role, company_name, phone, address, city, country, tax_id, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);

const admin = insUser.run(
  'admin@brightloop.io', hashPassword('Admin@1234'), 'Aarav Menon', 'admin',
  'Brightloop Software', '+91 98400 11223', '7th Floor, Tidel Park, Taramani', 'Chennai', 'India', '33AABCB1234C1ZX',
  dayjs().subtract(420, 'day').format('YYYY-MM-DD HH:mm:ss')
).lastInsertRowid;

const staff = [
  ['priya@brightloop.io', 'Priya Raghavan', 'Billing Operations'],
  ['karthik@brightloop.io', 'Karthik Subramanian', 'Sales'],
  ['meera@brightloop.io', 'Meera Iyer', 'Customer Success'],
].map(([email, name]) => {
  return insUser.run(
    email, hashPassword('Staff@1234'), name, 'staff', 'Brightloop Software', '+91 98400 55667',
    '7th Floor, Tidel Park', 'Chennai', 'India', null,
    dayjs().subtract(randInt(200, 380), 'day').format('YYYY-MM-DD HH:mm:ss')
  ).lastInsertRowid;
});

const companies = [
  ['Anand Traders', 'Nandini Anand', 'Chennai', 'Tamil Nadu'],
  ['Zenith Logistics', 'Rahul Verma', 'Bengaluru', 'Karnataka'],
  ['Coastal Foods Pvt Ltd', 'Divya Nair', 'Kochi', 'Kerala'],
  ['Meridian Consulting', 'Arjun Kapoor', 'Mumbai', 'Maharashtra'],
  ['Sunrise Retail', 'Kavya Reddy', 'Hyderabad', 'Telangana'],
  ['Nova Analytics', 'Sameer Khan', 'Pune', 'Maharashtra'],
  ['GreenLeaf Organics', 'Ananya Bose', 'Kolkata', 'West Bengal'],
  ['Pinnacle Motors', 'Vikram Chauhan', 'Delhi', 'Delhi'],
  ['Bluewave Studios', 'Ishita Desai', 'Ahmedabad', 'Gujarat'],
  ['Orbit Infotech', 'Nikhil Menon', 'Coimbatore', 'Tamil Nadu'],
  ['Silverline Textiles', 'Deepa Kumar', 'Tirupur', 'Tamil Nadu'],
  ['Everest Education', 'Rohit Sharma', 'Jaipur', 'Rajasthan'],
  ['Coral Hospitality', 'Sneha Pillai', 'Goa', 'Goa'],
  ['Apex Manufacturing', 'Manoj Gupta', 'Ludhiana', 'Punjab'],
  ['Lumen Media', 'Tara Krishnan', 'Chennai', 'Tamil Nadu'],
  ['Vertex Pharma', 'Amit Joshi', 'Indore', 'Madhya Pradesh'],
  ['Harbor Shipping', 'Priyanka Das', 'Visakhapatnam', 'Andhra Pradesh'],
  ['Terra Builders', 'Suresh Rao', 'Nagpur', 'Maharashtra'],
  ['Quantum Retail Group', 'Neha Bansal', 'Noida', 'Uttar Pradesh'],
  ['Falcon Freight', 'Gaurav Singh', 'Gurugram', 'Haryana'],
  ['Willow Wellness', 'Lakshmi Narayan', 'Mysuru', 'Karnataka'],
  ['Atlas Insurance', 'Rohan Bhatt', 'Surat', 'Gujarat'],
  ['Cascade Foods', 'Meghna Rao', 'Mangaluru', 'Karnataka'],
  ['Summit Realty', 'Aditya Rane', 'Thane', 'Maharashtra'],
];

const customers = companies.map(([company, person, city, state], i) => {
  const email = `${person.split(' ')[0].toLowerCase()}@${company.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.com`;
  return insUser.run(
    email, hashPassword('Customer@1234'), person, 'customer', company,
    `+91 9${randInt(100000000, 899999999)}`,
    `${randInt(10, 90)}, ${pick(['MG Road', 'Anna Salai', 'Ring Road', 'Park Street', 'Sector 18', 'Marine Drive'])}`,
    city, 'India', `${randInt(10, 37)}AA${pick(['BC', 'XY', 'PQ', 'RS'])}${randInt(1000, 9999)}${pick(['C', 'D', 'E'])}1Z${randInt(10, 99)}`,
    dayjs(T).subtract(randInt(30, 400), 'day').format('YYYY-MM-DD HH:mm:ss')
  ).lastInsertRowid;
});

const staffPeople = ['Priya Raghavan', 'Karthik Subramanian', 'Meera Iyer']
  .map((name, idx) => ({ id: staff[idx], name }));
const companyOf = new Map(customers.map((id, idx) => [id, companies[idx][0]]));
const inr = (n) => '\u20b9' + Number(n).toLocaleString('en-IN');

/* ================================================================== */
/* 2. Taxes                                                            */
/* ================================================================== */
const insTax = db.prepare(
  `INSERT INTO taxes (name, code, rate, kind, applies_to, country) VALUES (?,?,?,?,?,?)`
);
const gst18 = insTax.run('GST 18%', 'GST18', 18, 'percent', 'all', 'India').lastInsertRowid;
const gst12 = insTax.run('GST 12%', 'GST12', 12, 'percent', 'all', 'India').lastInsertRowid;
const gst5 = insTax.run('GST 5%', 'GST05', 5, 'percent', 'goods', 'India').lastInsertRowid;
const cess = insTax.run('Swachh Bharat Cess 0.5%', 'SBC', 0.5, 'percent', 'service', 'India').lastInsertRowid;

/* ================================================================== */
/* 3. Products (+ variants)                                            */
/* ================================================================== */
const insProduct = db.prepare(
  `INSERT INTO products (name, sku, type, sales_price, cost_price, notes) VALUES (?,?,?,?,?,?)`
);
const insVariant = db.prepare(
  `INSERT INTO product_variants (product_id, attribute_name, attribute_value, price_extra) VALUES (?,?,?,?)`
);
const insProductTax = db.prepare('INSERT OR IGNORE INTO product_taxes (product_id, tax_id) VALUES (?,?)');

function product({ name, sku, type, sales, cost, notes, taxes = [gst18], variants = [] }) {
  const id = insProduct.run(name, sku, type, sales, cost, notes).lastInsertRowid;
  for (const t of taxes) insProductTax.run(id, t);
  for (const v of variants) insVariant.run(id, v.attribute || 'Brand', v.value, v.extra);
  return id;
}

const pSuite = product({
  name: 'Brightloop Business Suite', sku: 'BLS-SUITE', type: 'service',
  sales: 4500, cost: 1200, notes: 'Core ERP + accounting workspace. Billed per seat.',
  variants: [
    { attribute: 'Brand', value: 'Brightloop', extra: 0 },
    { attribute: 'Brand', value: 'Odoo', extra: 560 },
    { attribute: 'Brand', value: 'White-label', extra: 1250 },
  ],
});
const pCrm = product({
  name: 'Brightloop CRM', sku: 'BLS-CRM', type: 'service',
  sales: 1800, cost: 420, notes: 'Pipeline, quoting and customer portal.',
  variants: [
    { attribute: 'Edition', value: 'Standard', extra: 0 },
    { attribute: 'Edition', value: 'Professional', extra: 900 },
    { attribute: 'Edition', value: 'Enterprise', extra: 2400 },
  ],
});
const pPos = product({
  name: 'Brightloop POS Terminal', sku: 'BLS-POS', type: 'goods',
  sales: 12000, cost: 7400, notes: 'Android point-of-sale terminal, one per outlet.', taxes: [gst18, gst5],
});
const pAnalytics = product({
  name: 'Insight Analytics Add-on', sku: 'BLS-INS', type: 'digital',
  sales: 950, cost: 150, notes: 'Dashboards, forecasting and scheduled exports.',
});
const pBackup = product({
  name: 'Managed Backup 100GB', sku: 'BLS-BKP', type: 'digital',
  sales: 320, cost: 90, notes: 'Daily encrypted off-site backup. Attaches to any plan.',
});
const pSupport = product({
  name: 'Priority Support', sku: 'BLS-SUP', type: 'service',
  sales: 1500, cost: 600, notes: '4-hour SLA, dedicated success manager.', taxes: [gst18, cess],
});
const pOnboarding = product({
  name: 'Onboarding & Data Migration', sku: 'BLS-ONB', type: 'service',
  sales: 25000, cost: 11000, notes: 'One-time implementation service.',
});

/* ================================================================== */
/* 4. Plans                                                            */
/* ================================================================== */
const insPlan = db.prepare(
  `INSERT INTO plans (name, code, product_id, billing_period, interval_count, price, min_quantity,
     available_from, available_to, allow_close, allow_pause, allow_renew, close_on_end, max_renewals, notes)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);
const planIds = {};

planIds.starterMonthly = insPlan.run(
  'Starter Monthly', 'STARTER-M', pSuite, 'monthly', 1, 4500, 1,
  dayjs(T).subtract(300, 'day').format('YYYY-MM-DD'), null, 1, 1, 1, 0, 0,
  'Entry tier, month-to-month, cancellable any time.'
).lastInsertRowid;

planIds.growthMonthly = insPlan.run(
  'Growth Monthly', 'GROWTH-M', pSuite, 'monthly', 1, 8500, 3,
  dayjs(T).subtract(280, 'day').format('YYYY-MM-DD'), null, 1, 1, 1, 0, 0,
  'Most popular. Minimum 3 seats.'
).lastInsertRowid;

planIds.enterpriseYearly = insPlan.run(
  'Enterprise Yearly', 'ENT-Y', pSuite, 'yearly', 1, 128000, 10,
  dayjs(T).subtract(350, 'day').format('YYYY-MM-DD'), null, 0, 0, 1, 1, 0,
  'Annual contract. Cannot be closed early or paused; auto-renews.'
).lastInsertRowid;

planIds.crmMonthly = insPlan.run(
  'CRM Monthly', 'CRM-M', pCrm, 'monthly', 1, 1800, 1,
  dayjs(T).subtract(250, 'day').format('YYYY-MM-DD'), null, 1, 1, 1, 1, 0,
  'Pay as you go CRM seats.'
).lastInsertRowid;

planIds.crmQuarterly = insPlan.run(
  'CRM Quarterly', 'CRM-Q', pCrm, 'monthly', 3, 4800, 2,
  dayjs(T).subtract(240, 'day').format('YYYY-MM-DD'), null, 1, 1, 1, 1, 0,
  'Prepay three months, save ~11%.'
).lastInsertRowid;

planIds.weeklyPilot = insPlan.run(
  'Weekly Pilot', 'PILOT-W', pCrm, 'weekly', 1, 900, 1,
  dayjs(T).subtract(200, 'day').format('YYYY-MM-DD'), dayjs(T).add(180, 'day').format('YYYY-MM-DD'), 1, 1, 0, 1, 0,
  'Short pilot engagements, closes automatically after 4 weeks.'
).lastInsertRowid;

planIds.dailyOps = insPlan.run(
  'Daily Ops Meter', 'OPS-D', pAnalytics, 'daily', 1, 250, 1,
  dayjs(T).subtract(150, 'day').format('YYYY-MM-DD'), null, 1, 1, 1, 1, 0,
  'Usage-metered daily billing for burst projects.'
).lastInsertRowid;

planIds.supportAnnual = insPlan.run(
  'Priority Support Annual', 'SUP-Y', pSupport, 'yearly', 1, 18000, 1,
  dayjs(T).subtract(300, 'day').format('YYYY-MM-DD'), null, 1, 0, 1, 1, 3,
  'Renews at most three times, then requires a new agreement.'
).lastInsertRowid;

/* ================================================================== */
/* 5. Quotation templates                                             */
/* ================================================================== */
const insTpl = db.prepare(
  `INSERT INTO quotation_templates (name, plan_id, validity_days, payment_term, quantity, notes) VALUES (?,?,?,?,?,?)`
);
const insTplLine = db.prepare(
  `INSERT INTO quotation_template_lines (template_id, product_id, label, quantity, unit_price) VALUES (?,?,?,?,?)`
);
const tplEnterprise = insTpl.run(
  'Enterprise Bundle (10 seats)', planIds.enterpriseYearly, 45, 'net45', 10,
  'Standard enterprise offer: suite + onboarding + priority support.'
).lastInsertRowid;
insTplLine.run(tplEnterprise, pOnboarding, 'Onboarding & Data Migration', 1, 25000);
insTplLine.run(tplEnterprise, pSupport, 'Priority Support — annual', 1, 18000);
insTplLine.run(tplEnterprise, pBackup, 'Managed Backup 100GB', 10, 320);

const tplGrowth = insTpl.run(
  'Growth + Analytics', planIds.growthMonthly, 30, 'net30', 3,
  'SMB upsell: suite plus the analytics add-on.'
).lastInsertRowid;
insTplLine.run(tplGrowth, pAnalytics, 'Insight Analytics Add-on', 3, 950);

const tplCrm = insTpl.run(
  'CRM Quick Start', planIds.crmMonthly, 15, 'net15', 5,
  'Fast-moving CRM deal with a 15-day validity.'
).lastInsertRowid;
insTplLine.run(tplCrm, pBackup, 'Managed Backup 100GB', 5, 320);

/* ================================================================== */
/* 6. Discount rules                                                   */
/* ================================================================== */
const insDiscount = db.prepare(
  `INSERT INTO discounts (code, name, kind, value, min_purchase, min_quantity, start_date, end_date,
     max_uses, applies_to, scope_note, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
);
const insDiscountProduct = db.prepare('INSERT OR IGNORE INTO discount_products (discount_id, product_id) VALUES (?,?)');

insDiscount.run('VOLUME10', 'Volume discount — 10 seats or more', 'percent', 10, 0, 10,
  dayjs(T).subtract(120, 'day').format('YYYY-MM-DD'), dayjs(T).add(240, 'day').format('YYYY-MM-DD'),
  50, 'subscription', 'Applies to whole subscription when quantity ≥ 10', admin);

insDiscount.run('WELCOME5', 'Welcome offer — ₹500 off first invoice', 'fixed', 500, 3000, 0,
  dayjs(T).subtract(60, 'day').format('YYYY-MM-DD'), dayjs(T).add(30, 'day').format('YYYY-MM-DD'),
  200, 'subscription', 'Onboarding sweetener for new customers', admin);

const dAnalytics = insDiscount.run('ANALYTICS15', 'Analytics add-on — 15% off', 'percent', 15, 0, 0,
  dayjs(T).subtract(90, 'day').format('YYYY-MM-DD'), dayjs(T).add(120, 'day').format('YYYY-MM-DD'),
  100, 'products', 'Only on the Insight Analytics Add-on', admin
).lastInsertRowid;
insDiscountProduct.run(dAnalytics, pAnalytics);

insDiscount.run('SUPPORT20', 'Priority Support — 20% off, 10 redemptions', 'percent', 20, 0, 0,
  dayjs(T).subtract(200, 'day').format('YYYY-MM-DD'), dayjs(T).subtract(10, 'day').format('YYYY-MM-DD'),
  10, 'products', 'Expired campaign — should stop applying on its own', admin);

/* ================================================================== */
/* 7. Subscriptions                                                    */
/* ================================================================== */
/* Activity trail — mirrors what logActivity() writes at runtime so the
   subscription History panel and the Activity log are populated. */
const insActivity = db.prepare(
  `INSERT INTO activity_log (user_id, actor, action, entity, entity_id, summary, created_at)
   VALUES (?,?,?,?,?,?,?)`
);
function logEvent(who, action, entity, entityId, summary, at) {
  insActivity.run(who.id, who.name, action, entity, entityId, summary,
    (at || dayjs(T).format('YYYY-MM-DD HH:mm:ss')));
}

const insSub = db.prepare(
  `INSERT INTO subscriptions (number, customer_id, plan_id, template_id, state, start_date, expiry_date,
     quantity, unit_price, payment_term, auto_renew, next_billing_date, last_billed_until, notes, created_by,
     renewal_count, closed_at, close_reason, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);
const insSubLine = db.prepare(
  `INSERT INTO subscription_lines (subscription_id, product_id, label, quantity, unit_price, is_plan_line)
   VALUES (?,?,?,?,?,?)`
);

let subCounter = 0;
const years = dayjs().year();
const nextSubNo = () => {
  subCounter += 1;
  return `SUB-${years}-${String(subCounter).padStart(4, '0')}`;
};

const planCatalogue = [
  { id: planIds.starterMonthly, period: 'monthly', interval: 1, price: 4500, product: pSuite, name: 'Starter Monthly' },
  { id: planIds.growthMonthly, period: 'monthly', interval: 1, price: 8500, product: pSuite, name: 'Growth Monthly' },
  { id: planIds.enterpriseYearly, period: 'yearly', interval: 1, price: 128000, product: pSuite, name: 'Enterprise Yearly' },
  { id: planIds.crmMonthly, period: 'monthly', interval: 1, price: 1800, product: pCrm, name: 'CRM Monthly' },
  { id: planIds.crmQuarterly, period: 'monthly', interval: 3, price: 4800, product: pCrm, name: 'CRM Quarterly' },
  { id: planIds.weeklyPilot, period: 'weekly', interval: 1, price: 900, product: pCrm, name: 'Weekly Pilot' },
  { id: planIds.dailyOps, period: 'daily', interval: 1, price: 250, product: pAnalytics, name: 'Daily Ops Meter' },
  { id: planIds.supportAnnual, period: 'yearly', interval: 1, price: 18000, product: pSupport, name: 'Priority Support Annual' },
];

const addons = [
  { product: pAnalytics, price: 950, label: 'Insight Analytics Add-on' },
  { product: pBackup, price: 320, label: 'Managed Backup 100GB' },
  { product: pSupport, price: 1500, label: 'Priority Support' },
];

const subscriptions = [];

/* Billing history shape:
   - daily / weekly plans only carry a couple of months of history (they would
     otherwise generate hundreds of invoices each),
   - monthly plans carry 13–23 months so the whole 12-month window is covered,
   - yearly plans renew once, and their anniversaries are staggered so a huge
     annual invoice does not all land in the same month.
   Together this produces a believable, readable revenue trend. */
function shapeFor(plan, i) {
  switch (plan.period) {
    case 'daily': return { startDaysAgo: randInt(12, 26) };
    case 'weekly': return { startDaysAgo: randInt(70, 190) };
    case 'yearly': return { startDaysAgo: 370 + randInt(0, 350) };
    case 'monthly':
    default: return { startDaysAgo: 395 + ((i * 23) % 290) };
  }
}

for (let i = 0; i < 58; i++) {
  const customer = customers[i % customers.length];
  const plan = planCatalogue[i % planCatalogue.length];
  const quantity = plan.id === planIds.enterpriseYearly ? randInt(1, 3)
    : plan.id === planIds.growthMonthly ? randInt(4, 16)
      : plan.id === planIds.starterMonthly ? randInt(2, 9)
        : randInt(1, 6);

  const { startDaysAgo } = shapeFor(plan, i);
  const startDate = dayjs(T).subtract(startDaysAgo, 'day').format('YYYY-MM-DD');

  // Term end: a spread of healthy contracts and some expiring soon.
  const expiry = dayjs(T).add(randInt(-25, 330), 'day').format('YYYY-MM-DD');

  const roll = rand();
  let state = 'active';
  if (roll > 0.95) state = 'draft';
  else if (roll > 0.90) state = 'quotation';
  else if (roll > 0.86) state = 'confirmed';
  else if (roll > 0.81) state = 'paused';
  else if (roll > 0.75) state = 'closed';

  const paymentTerm = pick(['net30', 'net30', 'net30', 'net15', 'net45', 'immediate']);

  // An active contract cannot have already lapsed — push its expiry forward.
  const effectiveExpiry = state === 'active'
    ? dayjs(T).add(randInt(6, 330), 'day').format('YYYY-MM-DD')
    : expiry;

  const sid = insSub.run(
    nextSubNo(), customer, plan.id, null, state, startDate, effectiveExpiry, quantity, plan.price, paymentTerm,
    rand() > 0.15 ? 1 : 0, null, null,
    state === 'closed' ? 'Customer consolidated onto a different plan.' : null,
    staff[i % staff.length], 0,
    state === 'closed' ? dayjs(T).subtract(randInt(1, 120), 'day').format('YYYY-MM-DD HH:mm:ss') : null,
    state === 'closed' ? 'Closed by customer' : null,
    dayjs(startDate).format('YYYY-MM-DD HH:mm:ss')
  ).lastInsertRowid;

  insSubLine.run(sid, plan.product, `${plan.name} — ${plan.period}`, quantity, plan.price, 1);

  if (rand() > 0.5) {
    const addon = pick(addons);
    insSubLine.run(sid, addon.product, addon.label, randInt(1, Math.max(1, Math.floor(quantity / 2))), addon.price, 0);
  }

  // Timeline for the subscription detail page
  const owner = staffPeople[i % staffPeople.length];
  logEvent(owner, 'create', 'subscription', sid,
    `Created ${plan.name} for ${companyOf.get(customer)} · ${quantity} × ${inr(plan.price)}`, `${startDate} 09:20:00`);
  if (['active', 'paused', 'closed'].includes(state)) {
    logEvent(owner, 'confirm', 'subscription', sid, 'Confirmed the subscription and locked the line items.', `${startDate} 11:05:00`);
    logEvent(owner, 'activate', 'subscription', sid, 'Activated — recurring billing scheduled from the start date.', `${startDate} 11:12:00`);
  }
  if (state === 'paused') logEvent(owner, 'pause', 'subscription', sid, 'Paused at the customer\'s request; billing suspended.', `${startDate} 12:00:00`);
  if (state === 'closed') logEvent(owner, 'close', 'subscription', sid, 'Closed — customer consolidated onto a different plan.', null);

  subscriptions.push({ id: sid, state, startDate, expiry, plan, quantity, paymentTerm, customer });
}

/* ================================================================== */
/* 8. Billing history — invoices + payments across the last year       */
/* ================================================================== */
console.log(`  ${subscriptions.length} subscriptions created — generating invoice history…`);

const methods = ['bank_transfer', 'upi', 'card', 'cheque', 'razorpay', 'stripe'];
let invoiceCount = 0;
let paymentCounter = 0;
const insPayment = db.prepare(
  `INSERT INTO payments (number, invoice_id, customer_id, method, amount, payment_date, reference, note, created_by, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`
);

const dueDateOffsetFor = (term) => ({ immediate: 0, net7: 7, net15: 15, net30: 30, net45: 45, net60: 60 }[term] ?? 30);

/* Lifecycle timestamps must never land in the future. */
const stamp = (date, addDays, hour) => {
  const d = dayjs(date).add(addDays, 'day').hour(hour).minute(randInt(0, 59));
  return (d.isAfter(dayjs(T)) ? dayjs(T).hour(hour).minute(randInt(0, 59)) : d).format('YYYY-MM-DD HH:mm:ss');
};

const stepUnit = (p) => ({ daily: ['day', 1], weekly: ['day', 7], monthly: ['month', 1], yearly: ['year', 1] }[p]);

// Three active contracts are deliberately left un-billed for their current
// period so the Billing runs screen has real "due now" work to sweep.
const laggingIds = new Set(
  subscriptions.filter((s) => s.state === 'active' && s.plan.period !== 'yearly')
    .slice(0, 3).map((s) => s.id)
);

for (const sub of subscriptions) {
  if (['draft', 'quotation', 'confirmed'].includes(sub.state)) continue;

  const [unit] = stepUnit(sub.plan.period);
  const step = sub.plan.period === 'weekly' ? 7 : sub.plan.interval;
  const stepKind = sub.plan.period === 'weekly' ? 'day' : unit;

  let cursor = sub.startDate;
  let guard = 0;
  let lastPeriodEnd = null;

  while (guard < 40 && !dayjs(cursor).isAfter(dayjs(T), 'day')) {
    guard++;

    let periodEnd;
    if (sub.plan.period === 'daily') periodEnd = cursor;
    else if (sub.plan.period === 'weekly') periodEnd = dayjs(cursor).add(6, 'day').format('YYYY-MM-DD');
    else periodEnd = dayjs(addCycle(cursor, sub.plan.period, sub.plan.interval)).subtract(1, 'day').format('YYYY-MM-DD');

    if (dayjs(periodEnd).isAfter(dayjs(sub.expiry), 'day')) periodEnd = sub.expiry;
    if (dayjs(cursor).isAfter(dayjs(sub.expiry), 'day')) break;
    if (laggingIds.has(sub.id) && !dayjs(periodEnd).isBefore(dayjs(T).subtract(2, 'day'))) break;

    const subRow = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(sub.id);
    const res = buildInvoiceForSubscription(subRow, { periodStart: cursor, periodEnd, asOf: T, createdBy: staff[0] });

    if (!res.skipped) {
      invoiceCount++;
      const inv = res.invoice;
      const ageDays = dayjs(T).diff(dayjs(inv.invoice_date), 'day');
      lastPeriodEnd = periodEnd;

      // Older invoices are nearly all settled; the newest ones carry the
      // open / overdue balances the finance team is meant to chase.
      let payRoll = rand();
      let state;
      let paidAmount = 0;

      if (ageDays > 75) {
        state = payRoll < 0.985 ? 'paid' : 'confirmed';
        paidAmount = state === 'paid' ? inv.total : round2(inv.total * 0.5);
      } else if (ageDays > 40) {
        state = payRoll < 0.93 ? 'paid' : 'confirmed';
        paidAmount = state === 'paid' ? inv.total : round2(inv.total * pick([0, 0.4, 0.6]));
      } else if (ageDays > 12) {
        state = payRoll < 0.72 ? 'paid' : 'confirmed';
        paidAmount = state === 'paid' ? inv.total : round2(inv.total * pick([0, 0.25, 0.5]));
      } else {
        state = payRoll < 0.45 ? 'paid' : 'confirmed';
        paidAmount = state === 'paid' ? inv.total : 0;
      }

      if (paidAmount > 0) {
        paymentCounter++;
        const payDate = dayjs(inv.invoice_date).add(randInt(2, Math.min(35, Math.max(3, ageDays))), 'day');
        const method = pick(methods);
        insPayment.run(
          `PAY-${years}-${String(paymentCounter).padStart(4, '0')}`, inv.id, inv.customer_id, method,
          round2(paidAmount), (payDate.isAfter(dayjs(T)) ? dayjs(T) : payDate).format('YYYY-MM-DD'),
          `${method.toUpperCase().slice(0, 4)}${randInt(10000, 99999)}`, 'Auto-matched from bank statement',
          staff[0], dayjs(inv.invoice_date).add(2, 'day').format('YYYY-MM-DD HH:mm:ss')
        );
      }

      const balance = round2(inv.total - paidAmount);
      const fullyPaid = balance <= 0.01;
      db.prepare(
        `UPDATE invoices SET state = ?, amount_paid = ?, balance = ?, confirmed_at = ?, paid_at = ?,
           sent_at = ? WHERE id = ?`
      ).run(
        fullyPaid ? 'paid' : state,
        round2(paidAmount),
        fullyPaid ? 0 : balance,
        stamp(inv.invoice_date, 1, 10),
        fullyPaid ? stamp(inv.invoice_date, randInt(3, 30), 15) : null,
        stamp(inv.invoice_date, 0, 9),
        inv.id
      );
    }

    cursor = dayjs(cursor).add(step, stepKind).format('YYYY-MM-DD');
  }

  // The next billing date is exactly where the billing loop stopped, so the
  // "due now" queue is honest: some are overdue, most are in the future.
  if (sub.state === 'active' && (lastPeriodEnd || laggingIds.has(sub.id))) {
    db.prepare('UPDATE subscriptions SET next_billing_date = ?, last_billed_until = ? WHERE id = ?')
      .run(cursor, lastPeriodEnd, sub.id);
  }
}

/* ================================================================== */
/* 9. A few draft invoices waiting for the morning confirm             */
/* ================================================================== */
const activeSubs = db.prepare(
  `SELECT * FROM subscriptions
    WHERE state = 'active' AND next_billing_date IS NOT NULL
      AND date(next_billing_date) <= date(?, '+45 day')
    ORDER BY next_billing_date LIMIT 20`
) .all(T).filter((s) => !laggingIds.has(s.id)).slice(0, 6);
for (const s of activeSubs) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(s.plan_id);
  // Billboard the *next* unbilled period — never a period already invoiced.
  const ps = s.next_billing_date;
  let pe = dayjs(addCycle(ps, plan.billing_period, plan.interval_count)).subtract(1, 'day').format('YYYY-MM-DD');
  if (dayjs(pe).isAfter(dayjs(s.expiry_date), 'day')) pe = s.expiry_date;
  if (dayjs(ps).isAfter(dayjs(pe), 'day')) continue;
  const r = buildInvoiceForSubscription(s, { periodStart: ps, periodEnd: pe, asOf: T, createdBy: staff[0] });
  // Issued today for the upcoming period, still awaiting confirmation.
  if (!r.skipped && r.invoice) {
    const due = dayjs(T).add(dueDateOffsetFor(s.payment_term), 'day').format('YYYY-MM-DD');
    db.prepare('UPDATE invoices SET invoice_date = ?, due_date = ?, created_at = ? WHERE id = ?')
      .run(T, due, `${T} 07:30:00`, r.invoice.id);
  }
}

/* ================================================================== */
/* 10. Billing-run history                                            */
/* ================================================================== */
const insRun = db.prepare(
  `INSERT INTO billing_runs (trigger_source, as_of_date, status, subscriptions_swept, invoices_created,
     invoices_skipped, total_amount, duration_ms, detail, started_at, finished_at)
   VALUES (?,?,'completed',?,?,?,?,?,?,?,?)`
);
for (let m = 11; m >= 0; m--) {
  const d = m === 0 ? dayjs(T) : dayjs(T).subtract(m, 'month').date(1);
  const created = randInt(8, 30);
  insRun.run(
    'scheduler', d.format('YYYY-MM-DD'), randInt(20, 55), created, 0,
    round2(created * randInt(4000, 22000)), randInt(180, 900),
    JSON.stringify([{ action: 'sweep', invoice_count: created }]),
    d.format('YYYY-MM-DD HH:mm:ss'), d.add(2, 'second').format('YYYY-MM-DD HH:mm:ss')
  );
}

/* ================================================================== */
/* 11. Mail outbox + activity so the feeds are not empty              */
/* ================================================================== */
const insMail = db.prepare(
  `INSERT INTO mail_outbox (to_email, subject, body, category, created_at) VALUES (?,?,?,?,?)`
);
insMail.run('priya@brightloop.io', 'Welcome to Brightloop', 'Your account is ready. Explore plans in the portal.', 'welcome',
  dayjs().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss'));
insMail.run('billing@brightloop.io', 'Monthly revenue digest', 'MRR grew 4.2% this month. 3 invoices are overdue.', 'report',
  dayjs().subtract(1, 'day').format('YYYY-MM-DD HH:mm:ss'));

logEvent({ id: admin, name: 'Aarav Menon' }, 'seed', 'database', null, 'Demo dataset seeded');

/* Keep the document sequences in step with the seeded numbers. */
syncCounters();

/* ================================================================== */
/* Done                                                                */
/* ================================================================== */
const stats = {
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
  plans: db.prepare('SELECT COUNT(*) c FROM plans').get().c,
  subscriptions: db.prepare('SELECT COUNT(*) c FROM subscriptions').get().c,
  invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c,
  payments: db.prepare('SELECT COUNT(*) c FROM payments').get().c,
  discounts: db.prepare('SELECT COUNT(*) c FROM discounts').get().c,
};

console.log('\n  Seed complete:');
for (const [k, v] of Object.entries(stats)) console.log(`    ${k.padEnd(14)} ${v}`);
console.log(`
  Sign in with
    Admin     admin@brightloop.io    / Admin@1234
    Staff     priya@brightloop.io    / Staff@1234
    Customer  nandini@anandtraders.com / Customer@1234

  (Every seeded customer uses the password Customer@1234.)
`);
