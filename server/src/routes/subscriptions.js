import { Router } from 'express';
import dayjs from 'dayjs';
import { db, getSetting } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import { buildInvoiceForSubscription, closeSubscription } from '../lib/billing.js';
import {
  addCycle, ApiError, bad, dueDateFor, logActivity, monthlyValue, notFound, paged,
  parsePaging, queueMail, requireFields, round2, today,
} from '../lib/util.js';

const router = Router();
router.use(authenticate);

/** Customers only ever see their own subscriptions. */
const scopeClause = (user, params) => {
  if (user.role === 'customer') { params.push(user.id); return 's.customer_id = ?'; }
  return null;
};

/* ==================================================================== */
/* GET /api/subscriptions                                                */
/* ==================================================================== */
router.get('/', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 20);
    const where = [];
    const params = [];

    const scoped = scopeClause(req.user, params);
    if (scoped) where.push(scoped);

    if (req.query.state) {
      const states = String(req.query.state).split(',').filter(Boolean);
      where.push(`s.state IN (${states.map(() => '?').join(',')})`);
      params.push(...states);
    }
    const q = (req.query.q || '').trim();
    if (q) {
      where.push('(s.number LIKE ? OR u.name LIKE ? OR u.company_name LIKE ? OR u.email LIKE ? OR pl.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.plan_id) { where.push('s.plan_id = ?'); params.push(Number(req.query.plan_id)); }
    if (req.query.customer_id) { where.push('s.customer_id = ?'); params.push(Number(req.query.customer_id)); }
    if (req.query.due === 'true') { where.push("s.state = 'active' AND s.next_billing_date <= ?"); params.push(today()); }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM subscriptions s
        JOIN users u ON u.id = s.customer_id
        JOIN plans pl ON pl.id = s.plan_id ${w}`;

    const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...params).c;
    const rows = db.prepare(
      `SELECT s.*, u.name AS customer_name, u.company_name, u.email AS customer_email,
              pl.name AS plan_name, pl.billing_period, pl.interval_count,
              (SELECT COUNT(*) FROM invoices i WHERE i.subscription_id = s.id AND i.state != 'cancelled') AS invoice_count,
              (SELECT COALESCE(SUM(i.balance),0) FROM invoices i WHERE i.subscription_id = s.id AND i.state='confirmed') AS outstanding
         ${base}
        ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const rowsEnriched = rows.map((r) => ({
      ...r,
      mrr: round2(monthlyValue(r.billing_period, r.interval_count, r.unit_price * r.quantity)),
    }));

    // Summary counters for the list header (cheap aggregate, indexed).
    const summary = db.prepare(
      `SELECT state, COUNT(*) c FROM subscriptions s ${scoped ? 'WHERE s.customer_id = ?' : ''} GROUP BY state`
    ).all(...(scoped ? [req.user.id] : []));

    res.json({
      ...paged(rowsEnriched, total, page, limit),
      summary: Object.fromEntries(summary.map((s) => [s.state, s.c])),
    });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/subscriptions/:id                                            */
/* ==================================================================== */
router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = db.prepare(
      `SELECT s.*, u.name AS customer_name, u.email AS customer_email, u.company_name, u.phone AS customer_phone,
              u.address AS customer_address, u.city AS customer_city, u.country AS customer_country, u.tax_id AS customer_tax_id,
              pl.name AS plan_name, pl.billing_period, pl.interval_count, pl.allow_pause, pl.allow_close,
              pl.allow_renew, pl.close_on_end, pl.max_renewals, pl.min_quantity,
              p.name AS product_name
         FROM subscriptions s
         JOIN users u ON u.id = s.customer_id
         JOIN plans pl ON pl.id = s.plan_id
         JOIN products p ON p.id = pl.product_id
        WHERE s.id = ?`
    ).get(id);
    if (!sub) throw notFound('Subscription not found');
    if (req.user.role === 'customer' && sub.customer_id !== req.user.id) throw new ApiError(403, 'This subscription belongs to another account.');

    sub.lines = db.prepare(
      `SELECT l.*, p.name AS product_name, v.attribute_value AS variant_name
         FROM subscription_lines l
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id
        WHERE l.subscription_id = ? ORDER BY l.is_plan_line DESC, l.id`
    ).all(id);

    sub.invoices = db.prepare(
      `SELECT id, number, state, invoice_date, due_date, period_start, period_end, total, amount_paid, balance
         FROM invoices WHERE subscription_id = ? ORDER BY invoice_date DESC`
    ).all(id);

    sub.timeline = db.prepare(
      `SELECT created_at, actor, action, summary FROM activity_log
        WHERE entity = 'subscription' AND entity_id = ? ORDER BY created_at DESC LIMIT 40`
    ).all(id);

    sub.mrr = round2(monthlyValue(sub.billing_period, sub.interval_count, sub.unit_price * sub.quantity));
    res.json({ row: sub });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* POST /api/subscriptions                                               */
/* ==================================================================== */
router.post('/', internalOnly, (req, res, next) => {
  try {
    const {
      customer_id, plan_id, start_date, expiry_date, quantity, payment_term = 'net30',
      template_id, notes, lines = [], state = 'draft', duration_cycles,
    } = req.body || {};
    requireFields(req.body, ['customer_id', 'plan_id', 'start_date']);

    const customer = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'customer'").get(Number(customer_id));
    if (!customer) throw bad('Select a valid customer.');
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(Number(plan_id));
    if (!plan) throw bad('Select a valid plan.');
    if (!plan.is_active) throw bad('This plan is archived and cannot be sold.');

    const qty = Math.max(1, Number(quantity) || 1);
    if (qty < plan.min_quantity) throw bad(`This plan requires a minimum quantity of ${plan.min_quantity}.`);

    // Availability window enforced at the point of sale.
    if (plan.available_from && start_date < plan.available_from) throw bad(`This plan is not available before ${plan.available_from}.`);
    if (plan.available_to && start_date > plan.available_to) throw bad(`This plan is no longer available after ${plan.available_to}.`);

    const cycles = Math.max(1, Number(duration_cycles) || 1);
    const computedExpiry = expiry_date || dayjs(addCycle(start_date, plan.billing_period, plan.interval_count * cycles)).subtract(1, 'day').format('YYYY-MM-DD');
    if (computedExpiry < start_date) throw bad('The expiry date must be on or after the start date.');

    const unitPrice = round2(req.body.unit_price ?? plan.price);

    const id = db.transaction(() => {
      const number = db.nextNumber('subscription', getSetting('subscription_prefix', 'SUB'));
      const i = db.prepare(
        `INSERT INTO subscriptions
          (number, customer_id, plan_id, template_id, state, start_date, expiry_date, quantity, unit_price,
           payment_term, auto_renew, next_billing_date, notes, created_by, quotation_valid_until)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        number, customer.id, plan.id, template_id || null, state, start_date, computedExpiry, qty, unitPrice,
        payment_term, req.body.auto_renew === false ? 0 : 1, null, notes || null, req.user.id,
        state === 'quotation' ? dayjs(start_date).add(req.body.validity_days || 30, 'day').format('YYYY-MM-DD') : null
      );
      const sid = i.lastInsertRowid;

      const insLine = db.prepare(
        `INSERT INTO subscription_lines (subscription_id, product_id, variant_id, label, quantity, unit_price, discount_pct, tax_ids, is_plan_line)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      insLine.run(sid, plan.product_id, null, `${plan.name} — ${plan.billing_period}`, qty, unitPrice, 0, null, 1);

      for (const l of lines) {
        if (!l.product_id) continue;
        const variant = l.variant_id ? db.prepare('SELECT * FROM product_variants WHERE id = ?').get(l.variant_id) : null;
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id);
        const price = round2(l.unit_price ?? (product.sales_price + (variant?.price_extra || 0)));
        insLine.run(
          sid, l.product_id, l.variant_id || null,
          l.label || `${product.name}${variant ? ` (${variant.attribute_value})` : ''}`,
          Number(l.quantity) || 1, price, round2(l.discount_pct || 0),
          l.tax_ids ? JSON.stringify(l.tax_ids) : null, 0
        );
      }
      return sid;
    })();

    const created = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    logActivity(req.user, 'subscription.create', 'subscription', id, `${created.number} created for ${customer.name} (${created.state})`);
    res.status(201).json({ row: created });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* PATCH /api/subscriptions/:id — only while not closed/cancelled        */
/* ==================================================================== */
router.patch('/:id', internalOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    if (!sub) throw notFound('Subscription not found');
    if (['closed', 'cancelled'].includes(sub.state)) throw bad('A closed subscription can no longer be edited.');

    db.transaction(() => {
      const fields = ['quantity', 'unit_price', 'payment_term', 'start_date', 'expiry_date', 'notes', 'auto_renew'];
      const sets = []; const params = [];
      for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
      if (sets.length) {
        sets.push("updated_at = datetime('now')");
        db.prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      }
      if (Array.isArray(req.body.lines)) {
        db.prepare('DELETE FROM subscription_lines WHERE subscription_id = ? AND is_plan_line = 0').run(id);
        const insLine = db.prepare(
          `INSERT INTO subscription_lines (subscription_id, product_id, variant_id, label, quantity, unit_price, discount_pct, tax_ids, is_plan_line)
           VALUES (?,?,?,?,?,?,?,?,0)`
        );
        for (const l of req.body.lines) {
          if (!l.product_id) continue;
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id);
          const variant = l.variant_id ? db.prepare('SELECT * FROM product_variants WHERE id = ?').get(l.variant_id) : null;
          insLine.run(
            id, l.product_id, l.variant_id || null,
            l.label || `${product?.name || 'Item'}${variant ? ` (${variant.attribute_value})` : ''}`,
            Number(l.quantity) || 1,
            round2(l.unit_price ?? ((product?.sales_price || 0) + (variant?.price_extra || 0))),
            round2(l.discount_pct || 0), l.tax_ids ? JSON.stringify(l.tax_ids) : null
          );
        }
      }
    })();
    logActivity(req.user, 'subscription.update', 'subscription', id, `${sub.number} updated`);
    res.json({ row: db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* POST /api/subscriptions/:id/transition — the state machine            */
/* ==================================================================== */
const ALLOWED = {
  draft: ['send_quotation', 'confirm', 'cancel'],
  quotation: ['confirm', 'cancel'],
  confirmed: ['activate', 'cancel'],
  active: ['pause', 'close', 'renew'],
  paused: ['resume', 'close'],
  closed: [],
  cancelled: [],
};

router.post('/:id/transition', internalOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { action, reason } = req.body || {};
    requireFields(req.body, ['action']);
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    if (!sub) throw notFound('Subscription not found');
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(sub.plan_id);

    if (!ALLOWED[sub.state]?.includes(action)) {
      throw bad(`"${action}" is not allowed while the subscription is ${sub.state}.`);
    }

    const now = today();
    switch (action) {
      case 'send_quotation': {
        if (sub.state !== 'draft') throw bad('Only a draft can be sent as a quotation.');
        db.prepare(
          `UPDATE subscriptions SET state='quotation', quotation_valid_until = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(dayjs(now).add(30, 'day').format('YYYY-MM-DD'), id);
        logActivity(req.user, 'subscription.send_quotation', 'subscription', id, `${sub.number} sent as quotation`);
        break;
      }
      case 'confirm': {
        db.prepare("UPDATE subscriptions SET state='confirmed', updated_at = datetime('now') WHERE id = ?").run(id);
        logActivity(req.user, 'subscription.confirm', 'subscription', id, `${sub.number} confirmed`);
        break;
      }
      case 'activate': {
        // Billing starts at the first cycle on/after today (or the start date).
        const nextBill = dayjs(sub.start_date).isBefore(dayjs(now), 'day') ? now : sub.start_date;
        db.prepare(
          `UPDATE subscriptions SET state='active', next_billing_date = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(nextBill, id);
        logActivity(req.user, 'subscription.activate', 'subscription', id, `${sub.number} activated`);
        break;
      }
      case 'pause': {
        if (!plan.allow_pause) throw bad('This plan does not allow pausing.');
        db.prepare(
          `UPDATE subscriptions SET state='paused', paused_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(id);
        logActivity(req.user, 'subscription.pause', 'subscription', id, `${sub.number} paused — billing stops until resumed`);
        break;
      }
      case 'resume': {
        // Billing restarts from today, so paused time is not charged.
        db.prepare(
          `UPDATE subscriptions SET state='active', paused_at = NULL, next_billing_date = ?,
             updated_at = datetime('now') WHERE id = ?`
        ).run(now, id);
        logActivity(req.user, 'subscription.resume', 'subscription', id, `${sub.number} resumed`);
        break;
      }
      case 'close': {
        if (!plan.allow_close) throw bad('This plan cannot be closed early.');
        closeSubscription(id, reason || 'closed early by team', req.user);
        break;
      }
      case 'renew': {
        if (!plan.allow_renew) throw bad('This plan is not renewable.');
        if (plan.max_renewals > 0 && sub.renewal_count >= plan.max_renewals) {
          throw bad(`This plan allows at most ${plan.max_renewals} renewal(s).`);
        }
        const newExpiry = dayjs(sub.expiry_date).add(plan.interval_count, periodUnit(plan.billing_period)).format('YYYY-MM-DD');
        db.prepare(
          `UPDATE subscriptions SET expiry_date = ?, renewal_count = renewal_count + 1, state = CASE WHEN state='closed' THEN 'active' ELSE state END,
             next_billing_date = CASE WHEN next_billing_date IS NULL THEN ? ELSE next_billing_date END,
             updated_at = datetime('now') WHERE id = ?`
        ).run(newExpiry, sub.expiry_date, id);
        logActivity(req.user, 'subscription.renew', 'subscription', id, `${sub.number} renewed until ${newExpiry}`);
        break;
      }
      case 'cancel': {
        db.prepare(
          `UPDATE subscriptions SET state='cancelled', closed_at = datetime('now'), close_reason = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(reason || 'cancelled', id);
        logActivity(req.user, 'subscription.cancel', 'subscription', id, `${sub.number} cancelled`);
        break;
      }
      default: throw bad('Unknown action.');
    }

    res.json({ row: db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* POST /api/subscriptions/:id/bill — bill this one now                  */
/* ==================================================================== */
router.post('/:id/bill', internalOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    if (!sub) throw notFound('Subscription not found');
    if (sub.state !== 'active') throw bad('Only an active subscription can be billed.');

    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(sub.plan_id);
    const periodStart = sub.next_billing_date || today();
    if (dayjs(periodStart).isAfter(dayjs(sub.expiry_date), 'day')) {
      throw bad('This subscription has passed its expiry date — renew it before billing another period.');
    }
    let periodEnd = dayjs(addCycle(periodStart, plan.billing_period, plan.interval_count)).subtract(1, 'day').format('YYYY-MM-DD');
    if (dayjs(periodEnd).isAfter(dayjs(sub.expiry_date), 'day')) periodEnd = sub.expiry_date;

    const result = buildInvoiceForSubscription(sub, {
      periodStart, periodEnd, asOf: today(), createdBy: req.user.id, send: !!req.body?.send,
    });
    if (result.skipped) throw bad(`Nothing to bill — this period is already invoiced (${result.reason}).`, { invoice: result.invoice });

    const next = addCycle(periodStart, plan.billing_period, plan.interval_count);
    db.prepare('UPDATE subscriptions SET next_billing_date = ?, last_billed_until = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(next, periodEnd, id);

    logActivity(req.user, 'subscription.bill', 'subscription', id, `${sub.number} billed manually → ${result.invoice.number}`);
    res.status(201).json({ invoice: result.invoice });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* DELETE /api/subscriptions/:id — admin can hard-delete drafts only     */
/* ==================================================================== */
router.delete('/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    if (!sub) throw notFound('Subscription not found');
    const invoiced = db.prepare('SELECT COUNT(*) c FROM invoices WHERE subscription_id = ?').get(id).c;
    if (invoiced) throw bad('This subscription has invoices and cannot be deleted — close it instead.');
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
    logActivity(req.user, 'subscription.delete', 'subscription', id, `${sub.number} deleted`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const periodUnit = (p) => ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[p] || 'month');

export default router;
