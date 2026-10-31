import { Router } from 'express';
import dayjs from 'dayjs';
import { db } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import { runBillingSweep } from '../lib/billing.js';
import { addCycle, notFound, paged, parsePaging, round2, today } from '../lib/util.js';

const router = Router();
router.use(authenticate);

/* ==================================================================== */
/* GET /api/billing/preview — who would be billed right now?             */
/* ==================================================================== */
router.get('/preview', internalOnly, (req, res, next) => {
  try {
    const asOf = req.query.as_of || today();
    const rows = db.prepare(
      `SELECT s.id, s.number, s.quantity, s.unit_price, s.next_billing_date, s.expiry_date,
              u.name AS customer_name, u.company_name, pl.name AS plan_name,
              pl.billing_period, pl.interval_count, pl.product_id, pl.allow_renew,
              (SELECT COUNT(*) FROM invoices i WHERE i.subscription_id = s.id
                 AND i.period_start = s.next_billing_date AND i.state != 'cancelled') AS already_billed
         FROM subscriptions s
         JOIN users u ON u.id = s.customer_id
         JOIN plans pl ON pl.id = s.plan_id
        WHERE s.state = 'active' AND s.next_billing_date IS NOT NULL AND s.next_billing_date <= ?
        ORDER BY s.next_billing_date ASC LIMIT 500`
    ).all(asOf);

    const withAmounts = rows.map((r) => {
      let periodEnd = dayjs(addCycle(r.next_billing_date, r.billing_period, r.interval_count)).subtract(1, 'day').format('YYYY-MM-DD');
      // A subscription whose term has already lapsed is not billed again —
      // the sweep renews it (if the plan allows) or closes it.
      const termEnded = dayjs(r.next_billing_date).isAfter(dayjs(r.expiry_date), 'day');
      if (dayjs(periodEnd).isAfter(dayjs(r.expiry_date), 'day')) periodEnd = r.expiry_date;
      return {
        ...r,
        period_end: termEnded ? null : periodEnd,
        term_ended: termEnded ? 1 : 0,
        action: termEnded ? (r.allow_renew ? 'renew' : 'close') : 'bill',
        estimated_amount: round2(r.quantity * r.unit_price),
      };
    });

    res.json({
      as_of: asOf,
      count: withAmounts.length,
      estimated_total: round2(withAmounts.reduce((s, r) => s + r.estimated_amount, 0)),
      already_billed: withAmounts.filter((r) => r.already_billed > 0).length,
      rows: withAmounts,
    });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* POST /api/billing/run — the button the finance team presses           */
/* ==================================================================== */
router.post('/run', internalOnly, (req, res, next) => {
  try {
    const asOf = req.body?.as_of || today();
    // Anything with a higher id than this was raised by this sweep only.
    const before = db.prepare('SELECT COALESCE(MAX(id), 0) m FROM invoices').get().m;
    const result = runBillingSweep({ asOf, trigger: 'manual', user: req.user });
    const invoices = db.prepare(
      `SELECT i.*, u.name AS customer_name FROM invoices i JOIN users u ON u.id = i.customer_id
        WHERE i.id > ? ORDER BY i.id ASC LIMIT 500`
    ).all(before);
    res.json({ ...result, invoices });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/billing/runs — history of every sweep                        */
/* ==================================================================== */
router.get('/runs', internalOnly, (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 20);
    const total = db.prepare('SELECT COUNT(*) c FROM billing_runs').get().c;
    const rows = db.prepare(
      `SELECT * FROM billing_runs ORDER BY started_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
    res.json(paged(rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : [] })), total, page, limit));
  } catch (e) { next(e); }
});

router.get('/runs/:id', internalOnly, (req, res, next) => {
  try {
    const run = db.prepare('SELECT * FROM billing_runs WHERE id = ?').get(Number(req.params.id));
    if (!run) throw notFound('Billing run not found');
    res.json({ row: { ...run, detail: run.detail ? JSON.parse(run.detail) : [] } });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/billing/health — catches missed billing before it hurts      */
/* ==================================================================== */
router.get('/health', internalOnly, (_req, res, next) => {
  try {
    const asOf = today();
    const stale = db.prepare(
      `SELECT COUNT(*) c FROM subscriptions
        WHERE state='active' AND next_billing_date IS NOT NULL AND next_billing_date < ?`
    ).get(asOf).c;
    const dueToday = db.prepare(
      "SELECT COUNT(*) c FROM subscriptions WHERE state='active' AND next_billing_date = ?"
    ).get(asOf).c;
    const expiringSoon = db.prepare(
      `SELECT COUNT(*) c FROM subscriptions WHERE state='active' AND expiry_date BETWEEN ? AND ?`
    ).get(asOf, dayjs(asOf).add(30, 'day').format('YYYY-MM-DD')).c;
    const lastRun = db.prepare("SELECT * FROM billing_runs ORDER BY started_at DESC LIMIT 1").get();
    res.json({
      stale_backlog: stale,
      due_today: dueToday,
      expiring_in_30_days: expiringSoon,
      last_run: lastRun ? { ...lastRun, detail: lastRun.detail ? JSON.parse(lastRun.detail) : [] } : null,
    });
  } catch (e) { next(e); }
});

/* Every subscription whose next bill is within N days — the renewals radar. */
router.get('/upcoming', internalOnly, (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const from = today();
    const to = dayjs(from).add(days, 'day').format('YYYY-MM-DD');
    const rows = db.prepare(
      `SELECT s.id, s.number, s.next_billing_date, s.expiry_date, s.state, u.name AS customer_name,
              u.company_name, pl.name AS plan_name, pl.allow_renew, pl.close_on_end,
              ROUND((s.quantity * s.unit_price), 2) AS expected_amount
         FROM subscriptions s
         JOIN users u ON u.id = s.customer_id
         JOIN plans pl ON pl.id = s.plan_id
        WHERE s.state IN ('active','paused') AND s.next_billing_date BETWEEN ? AND ?
        ORDER BY s.next_billing_date ASC LIMIT 300`
    ).all(from, to);
    res.json({ days, from, to, rows });
  } catch (e) { next(e); }
});

export default router;
