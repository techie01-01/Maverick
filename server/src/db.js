import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'brightloop.db');

export const db = new Database(DB_FILE);

// Pragmas tuned for a read-heavy billing workload.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -32000');
db.pragma('temp_store = MEMORY');

export function migrate() {
  db.exec(`
  ---------------------------------------------------------------------------
  -- Users: admin / staff / customer. One email = one account.
  ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','staff','customer')) DEFAULT 'customer',
    company_name  TEXT,
    phone         TEXT,
    address       TEXT,
    city          TEXT,
    country       TEXT,
    tax_id        TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    must_reset    INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

  CREATE TABLE IF NOT EXISTS password_resets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ---------------------------------------------------------------------------
  -- Catalogue: products (+ variants), taxes, plans, quotation templates
  ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    sku          TEXT UNIQUE,
    type         TEXT NOT NULL DEFAULT 'service',  -- service | goods | digital
    sales_price  REAL NOT NULL DEFAULT 0,
    cost_price   REAL NOT NULL DEFAULT 0,
    notes        TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Variants, e.g. attribute "Brand" = "Odoo" adds 560 to the price.
  CREATE TABLE IF NOT EXISTS product_variants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_name TEXT NOT NULL DEFAULT 'Brand',
    attribute_value TEXT NOT NULL,
    price_extra    REAL NOT NULL DEFAULT 0,
    sku            TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

  CREATE TABLE IF NOT EXISTS taxes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    code              TEXT,
    rate              REAL NOT NULL DEFAULT 0,     -- percentage
    kind              TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
    fixed_amount      REAL NOT NULL DEFAULT 0,
    applies_to        TEXT NOT NULL DEFAULT 'all',  -- all | service | goods | digital
    included_in_price INTEGER NOT NULL DEFAULT 0,
    country           TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Taxes linked to a product become its default taxes on new lines.
  CREATE TABLE IF NOT EXISTS product_taxes (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tax_id     INTEGER NOT NULL REFERENCES taxes(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, tax_id)
  );

  CREATE TABLE IF NOT EXISTS plans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    code           TEXT UNIQUE,
    product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    billing_period TEXT NOT NULL DEFAULT 'monthly', -- daily|weekly|monthly|yearly
    interval_count INTEGER NOT NULL DEFAULT 1,
    price          REAL NOT NULL DEFAULT 0,
    min_quantity   INTEGER NOT NULL DEFAULT 1,
    available_from TEXT,
    available_to   TEXT,
    allow_close    INTEGER NOT NULL DEFAULT 1,   -- can be closed early
    allow_pause    INTEGER NOT NULL DEFAULT 1,   -- can be paused
    allow_renew    INTEGER NOT NULL DEFAULT 1,   -- can be renewed
    close_on_end   INTEGER NOT NULL DEFAULT 1,   -- auto-close when it expires
    max_renewals   INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
    trial_days     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_plans_product ON plans(product_id);

  -- Quotation templates: a ready-made set of plan + product lines.
  CREATE TABLE IF NOT EXISTS quotation_templates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    plan_id       INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    validity_days INTEGER NOT NULL DEFAULT 30,
    payment_term  TEXT NOT NULL DEFAULT 'net30',
    quantity      INTEGER NOT NULL DEFAULT 1,
    notes         TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quotation_template_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id  INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    label       TEXT,
    quantity    REAL NOT NULL DEFAULT 1,
    unit_price  REAL NOT NULL DEFAULT 0,
    discount_pct REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_qtl_template ON quotation_template_lines(template_id);

  ---------------------------------------------------------------------------
  -- Discounts: admin-only rules, auto-applied, capped usage / date window.
  ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS discounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
    value         REAL NOT NULL DEFAULT 0,
    min_purchase  REAL NOT NULL DEFAULT 0,
    min_quantity  INTEGER NOT NULL DEFAULT 0,
    start_date    TEXT,
    end_date      TEXT,
    max_uses      INTEGER NOT NULL DEFAULT 0,      -- 0 = unlimited
    used_count    INTEGER NOT NULL DEFAULT 0,
    applies_to    TEXT NOT NULL DEFAULT 'subscription', -- subscription | products
    scope_note    TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discount_products (
    discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, product_id)
  );

  ---------------------------------------------------------------------------
  -- Subscriptions + their lines
  ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS subscriptions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    number           TEXT NOT NULL UNIQUE,
    customer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_id          INTEGER NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    template_id      INTEGER REFERENCES quotation_templates(id) ON DELETE SET NULL,
    state            TEXT NOT NULL DEFAULT 'draft'
                     CHECK (state IN ('draft','quotation','confirmed','active','paused','closed','cancelled')),
    start_date       TEXT NOT NULL,
    expiry_date      TEXT NOT NULL,
    quantity         INTEGER NOT NULL DEFAULT 1,
    unit_price       REAL NOT NULL DEFAULT 0,
    payment_term     TEXT NOT NULL DEFAULT 'net30',
    auto_renew       INTEGER NOT NULL DEFAULT 1,
    renewal_count    INTEGER NOT NULL DEFAULT 0,
    next_billing_date TEXT,
    last_billed_until TEXT,
    quotation_valid_until TEXT,
    paused_at        TEXT,
    closed_at        TEXT,
    close_reason     TEXT,
    notes            TEXT,
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);
  CREATE INDEX IF NOT EXISTS idx_subs_state    ON subscriptions(state);
  CREATE INDEX IF NOT EXISTS idx_subs_billing  ON subscriptions(state, next_billing_date);
  CREATE INDEX IF NOT EXISTS idx_subs_plan     ON subscriptions(plan_id);
  CREATE INDEX IF NOT EXISTS idx_subs_expiry   ON subscriptions(state, expiry_date);

  CREATE TABLE IF NOT EXISTS subscription_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
    variant_id     INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    label          TEXT,
    quantity       REAL NOT NULL DEFAULT 1,
    unit_price     REAL NOT NULL DEFAULT 0,
    discount_pct   REAL NOT NULL DEFAULT 0,
    tax_ids        TEXT,
    is_plan_line   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sublines_sub ON subscription_lines(subscription_id);

  ---------------------------------------------------------------------------
  -- Invoices (+ lines, tax breakdown), payments, discount usage
  ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    number         TEXT NOT NULL UNIQUE,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    customer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    state          TEXT NOT NULL DEFAULT 'draft'
                   CHECK (state IN ('draft','confirmed','paid','cancelled')),
    invoice_date   TEXT NOT NULL,
    due_date       TEXT NOT NULL,
    period_start   TEXT,
    period_end     TEXT,
    subtotal       REAL NOT NULL DEFAULT 0,
    discount_total REAL NOT NULL DEFAULT 0,
    tax_total      REAL NOT NULL DEFAULT 0,
    total          REAL NOT NULL DEFAULT 0,
    amount_paid    REAL NOT NULL DEFAULT 0,
    balance        REAL NOT NULL DEFAULT 0,
    notes          TEXT,
    confirmed_at   TEXT,
    sent_at        TEXT,
    paid_at        TEXT,
    cancelled_at   TEXT,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Idempotency guard: a subscription can only be billed once per period.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_period
    ON invoices(subscription_id, period_start, period_end)
    WHERE subscription_id IS NOT NULL AND state != 'cancelled';
  CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id, state);
  CREATE INDEX IF NOT EXISTS idx_inv_state    ON invoices(state);
  CREATE INDEX IF NOT EXISTS idx_inv_due      ON invoices(state, due_date);
  CREATE INDEX IF NOT EXISTS idx_inv_date     ON invoices(invoice_date);

  CREATE TABLE IF NOT EXISTS invoice_lines (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
    variant_id      INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    quantity        REAL NOT NULL DEFAULT 1,
    unit_price      REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    discount_label  TEXT,
    tax_rate        REAL NOT NULL DEFAULT 0,
    tax_amount      REAL NOT NULL DEFAULT 0,
    amount          REAL NOT NULL DEFAULT 0,
    tax_ids         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_invlines_inv ON invoice_lines(invoice_id);

  CREATE TABLE IF NOT EXISTS invoice_taxes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    tax_id     INTEGER,
    name       TEXT NOT NULL,
    rate       REAL NOT NULL DEFAULT 0,
    base       REAL NOT NULL DEFAULT 0,
    amount     REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_invtaxes_inv ON invoice_taxes(invoice_id);

  CREATE TABLE IF NOT EXISTS payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    number       TEXT NOT NULL UNIQUE,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    method       TEXT NOT NULL DEFAULT 'bank_transfer',
    amount       REAL NOT NULL,
    payment_date TEXT NOT NULL,
    reference    TEXT,
    note         TEXT,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_pay_date    ON payments(payment_date);
  CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer_id);

  CREATE TABLE IF NOT EXISTS discount_usages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discount_id     INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    invoice_id      INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    customer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount          REAL NOT NULL DEFAULT 0,
    applied_on      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dusage_discount ON discount_usages(discount_id);

  ---------------------------------------------------------------------------
  -- Operations: billing runs, email outbox, audit trail, settings
  ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS billing_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_source   TEXT NOT NULL DEFAULT 'manual', -- manual | scheduler
    as_of_date       TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'completed',
    subscriptions_swept INTEGER NOT NULL DEFAULT 0,
    invoices_created INTEGER NOT NULL DEFAULT 0,
    invoices_skipped INTEGER NOT NULL DEFAULT 0,
    total_amount     REAL NOT NULL DEFAULT 0,
    duration_ms      INTEGER NOT NULL DEFAULT 0,
    detail           TEXT,
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS mail_outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    status     TEXT NOT NULL DEFAULT 'queued',
    meta       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mail_created ON mail_outbox(created_at);

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor      TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  INTEGER,
    summary    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Idempotency + performance helper: counters table for gapless sequences
  CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  -- Speeds up "which subscriptions are due?" without a full scan.
  CREATE TABLE IF NOT EXISTS _migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  const defaults = {
    company_name: 'Brightloop Software Pvt. Ltd.',
    company_email: 'billing@brightloop.io',
    company_phone: '+91 44 4000 1200',
    company_address: '7th Floor, Tidel Park, Taramani, Chennai 600113, India',
    company_tax_id: '33AABCB1234C1ZX',
    currency: 'INR',
    currency_symbol: '₹',
    invoice_prefix: 'INV',
    subscription_prefix: 'SUB',
    payment_prefix: 'PAY',
    default_payment_term: 'net30',
    billing_lookahead_days: '0',
    scheduler_enabled: '1',
    default_tax_rate: '18',
  };
  const ins = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value ?? ''));
}

/**
 * Re-sync the sequence counters with the highest number actually present in
 * each table. Guards against collisions after a manual import or seed.
 */
export function syncCounters() {
  const year = new Date().getFullYear();
  const specs = [
    ['subscription', 'subscriptions', getSetting('subscription_prefix', 'SUB')],
    ['invoice', 'invoices', getSetting('invoice_prefix', 'INV')],
    ['payment', 'payments', getSetting('payment_prefix', 'PAY')],
  ];
  for (const [kind, table, prefix] of specs) {
    const pattern = `${prefix}-${year}-%`;
    const row = db.prepare(
      `SELECT MAX(CAST(substr(number, ?) AS INTEGER)) m FROM ${table} WHERE number LIKE ?`
    ).get(`${prefix}-${year}-`.length + 1, pattern);
    const max = row?.m || 0;
    const name = `${kind}-${year}`;
    const current = db.prepare('SELECT value FROM counters WHERE name = ?').get(name)?.value || 0;
    if (max > current) {
      db.prepare('INSERT INTO counters (name, value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
        .run(name, max);
    }
  }
}

/** Gapless, race-safe document number: SUB-2026-0001 */
db.nextNumber = function nextNumber(kind, prefix) {
  const year = new Date().getFullYear();
  const name = `${kind}-${year}`;
  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)').run(name);
    db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
    return db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value;
  });
  // IMMEDIATE-ish behaviour: better-sqlite3 transactions are serialised.
  const seq = tx.immediate();
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
};
