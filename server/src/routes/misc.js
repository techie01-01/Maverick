import { Router } from 'express';
import dayjs from 'dayjs';
import { db, getSetting } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import { setSetting } from '../db.js';
import {
  bad, logActivity, monthlyValue, notFound, paged, parsePaging, requireFields, round2, settingsSnapshot, today,
} from '../lib/util.js';

const router = Router();

/* ==================================================================== */
/* SETTINGS (company profile, invoice prefix, currency…)                 */
/* ==================================================================== */
router.get('/settings', authenticate, (_req, res, next) => {
  try { res.json({ settings: settingsSnapshot() }); } catch (e) { next(e); }
});

router.put('/settings', adminOnly, (req, res, next) => {
  try {
    const body = req.body || {};
    const allowed = ['company_name', 'company_email', 'company_phone', 'company_address', 'company_tax_id',
      'currency', 'currency_symbol', 'invoice_prefix', 'subscription_prefix', 'payment_prefix',
      'default_payment_term', 'billing_lookahead_days', 'scheduler_enabled', 'default_tax_rate'];
    db.transaction(() => {
      for (const [k, v] of Object.entries(body)) if (allowed.includes(k)) setSetting(k, v);
    })();
    logActivity(req.user, 'settings.update', 'settings', null, 'Company settings updated');
    res.json({ settings: settingsSnapshot() });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* MAIL OUTBOX — the built-in "sent mail" view                           */
/* ==================================================================== */
router.get('/mail', internalOnly, (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 25);
    const where = []; const params = [];
    if (req.query.category) { where.push('category = ?'); params.push(req.query.category); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM mail_outbox ${w}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM mail_outbox ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    res.json(paged(rows, total, page, limit));
  } catch (e) { next(e); }
});

router.get('/mail/:id', internalOnly, (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(Number(req.params.id));
    if (!row) throw notFound('Message not found');
    res.json({ row });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* ACTIVITY FEED                                                         */
/* ==================================================================== */
router.get('/activity', internalOnly, (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 30);
    const total = db.prepare('SELECT COUNT(*) c FROM activity_log').get().c;
    const rows = db.prepare(
      `SELECT a.*, u.email FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
    res.json(paged(rows, total, page, limit));
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GLOBAL SEARCH — used by the command palette in the top bar            */
/* ==================================================================== */
router.get('/search', internalOnly, (req, res, next) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    if ((req.query.q || '').trim().length < 2) return res.json({ subscriptions: [], invoices: [], customers: [] });
    res.json({
      subscriptions: db.prepare(
        `SELECT s.id, s.number, s.state, u.name AS customer_name FROM subscriptions s
           JOIN users u ON u.id=s.customer_id
          WHERE s.number LIKE ? OR u.name LIKE ? OR u.company_name LIKE ?
          LIMIT 6`
      ).all(q, q, q),
      invoices: db.prepare(
        `SELECT i.id, i.number, i.state, i.total, u.name AS customer_name FROM invoices i
           JOIN users u ON u.id=i.customer_id
          WHERE i.number LIKE ? OR u.name LIKE ? LIMIT 6`
      ).all(q, q),
      customers: db.prepare(
        `SELECT id, name, email, company_name FROM users WHERE role='customer' AND (name LIKE ? OR email LIKE ? OR company_name LIKE ?) LIMIT 6`
      ).all(q, q, q),
    });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* CUSTOMER SELF-SERVICE PORTAL                                          */
/* ==================================================================== */

/** The catalogue a customer is allowed to see — live plans only. */
router.get('/portal/catalog', authenticate, (req, res, next) => {
  try {
    const asOf = today();
    const plans = db.prepare(
      `SELECT pl.*, p.name AS product_name, p.type AS product_type, p.notes AS product_notes,
              (SELECT GROUP_CONCAT(t.name || ' @ ' || t.rate || '%', ', ')
                 FROM product_taxes pt JOIN taxes t ON t.id = pt.tax_id WHERE pt.product_id = p.id) AS tax_summary
         FROM plans pl JOIN products p ON p.id = pl.product_id
        WHERE pl.is_active = 1 AND p.is_active = 1
          AND (pl.available_from IS NULL OR pl.available_from <= ?)
          AND (pl.available_to   IS NULL OR pl.available_to   >= ?)
        ORDER BY pl.price ASC`
    ).all(asOf, asOf);
    const variants = db.prepare('SELECT * FROM product_variants WHERE is_active = 1').all();
    const grouped = variants.reduce((a, v) => { (a[v.product_id] ||= []).push(v); return a; }, {});
    res.json({ rows: plans.map((p) => ({ ...p, variants: grouped[p.product_id] || [] })) });
  } catch (e) { next(e); }
});

/** A customer requests a plan; it lands on the team's desk as a quotation. */
router.post('/portal/subscribe', authenticate, (req, res, next) => {
  try {
    if (req.user.role === 'customer' || req.user.role === 'admin') {
      // customers self-serve; admin may also use it
    } else {
      throw bad('Only customers can request a plan from the portal.');
    }
    const { plan_id, quantity = 1, start_date = today(), notes } = req.body || {};
    requireFields(req.body, ['plan_id']);
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_active = 1').get(Number(plan_id));
    if (!plan) throw bad('That plan is not available.');
    if (plan.available_to && start_date > plan.available_to) throw bad('That plan is no longer available.');
    const qty = Math.max(1, Number(quantity) || 1);
    if (qty < plan.min_quantity) throw bad(`This plan has a minimum quantity of ${plan.min_quantity}.`);

    const expiry = dayjs(start_date).add(plan.interval_count, { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[plan.billing_period] || 'month').subtract(1, 'day').format('YYYY-MM-DD');

    const id = db.transaction(() => {
      const number = db.nextNumber('subscription', getSetting('subscription_prefix', 'SUB'));
      const info = db.prepare(
        `INSERT INTO subscriptions (number, customer_id, plan_id, state, start_date, expiry_date, quantity,
           unit_price, payment_term, next_billing_date, notes, quotation_valid_until, created_by)
         VALUES (?,?,?,'quotation',?,?,?,?,?,NULL,?,?,?)`
      ).run(number, req.user.id, plan.id, start_date, expiry, qty, round2(plan.price),
        getSetting('default_payment_term', 'net30'), notes || 'Requested by customer from the portal',
        dayjs(start_date).add(30, 'day').format('YYYY-MM-DD'), req.user.id);
      const sid = info.lastInsertRowid;
      db.prepare(
        `INSERT INTO subscription_lines (subscription_id, product_id, label, quantity, unit_price, is_plan_line)
         VALUES (?,?,?,?,?,1)`
      ).run(sid, plan.product_id, `${plan.name} — ${plan.billing_period}`, qty, round2(plan.price));
      return sid;
    })();

    logActivity(req.user, 'subscription.request', 'subscription', id, `${req.user.name} requested plan "${plan.name}" from the portal`);
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    res.status(201).json({ row: sub, message: 'Request submitted — our team will confirm it shortly.' });
  } catch (e) { next(e); }
});

/** Everything the customer's own home screen needs, in one round trip. */
router.get('/portal/summary', authenticate, (req, res, next) => {
  try {
    const uid = req.user.id;
    const subs = db.prepare(
      `SELECT s.*, pl.name AS plan_name, pl.billing_period, pl.interval_count, p.name AS product_name
         FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id JOIN products p ON p.id = pl.product_id
        WHERE s.customer_id = ? ORDER BY s.created_at DESC`
    ).all(uid);

    const invoices = db.prepare(
      `SELECT id, number, state, invoice_date, due_date, total, amount_paid, balance, subscription_id
         FROM invoices WHERE customer_id = ? ORDER BY invoice_date DESC LIMIT 50`
    ).all(uid);

    const outstanding = db.prepare(
      "SELECT COALESCE(SUM(balance),0) s, COUNT(*) c FROM invoices WHERE customer_id = ? AND state='confirmed' AND balance > 0"
    ).get(uid);

    const paidTotal = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE customer_id = ?').get(uid).s;

    const upcoming = db.prepare(
      `SELECT s.id, s.number, s.next_billing_date, s.expiry_date, s.unit_price, s.quantity, pl.name AS plan_name
         FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
        WHERE s.customer_id = ? AND s.state = 'active' AND s.next_billing_date IS NOT NULL
        ORDER BY s.next_billing_date LIMIT 5`
    ).all(uid);

    res.json({
      subscriptions: subs.map((s) => ({
        ...s,
        mrr: round2(monthlyValue(s.billing_period, s.interval_count, s.unit_price * s.quantity)),
      })),
      invoices,
      outstanding: { amount: round2(outstanding.s), count: outstanding.c },
      lifetime_paid: round2(paidTotal),
      upcoming,
      monthly_spend: round2(subs.filter((s) => s.state === 'active')
        .reduce((sum, s) => sum + monthlyValue(s.billing_period, s.interval_count, s.unit_price * s.quantity), 0)),
    });
  } catch (e) { next(e); }
});

export default router;
