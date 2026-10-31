import { Router } from 'express';
import dayjs from 'dayjs';
import { db } from '../db.js';
import { authenticate, internalOnly } from '../lib/auth.js';
import { round2, today } from '../lib/util.js';

const router = Router();
router.use(authenticate);

const MRR_SQL = `
  CASE pl.billing_period
    WHEN 'daily'  THEN s.unit_price * s.quantity * 365.0 / 12.0 / pl.interval_count
    WHEN 'weekly' THEN s.unit_price * s.quantity * 52.0  / 12.0 / pl.interval_count
    WHEN 'yearly' THEN s.unit_price * s.quantity / 12.0 / pl.interval_count
    ELSE s.unit_price * s.quantity / pl.interval_count
  END`;

/* ==================================================================== */
/* GET /api/reports/dashboard                                            */
/* ==================================================================== */
router.get('/dashboard', internalOnly, (req, res, next) => {
  try {
    const asOf = req.query.as_of || today();
    const monthStart = dayjs(asOf).startOf('month').format('YYYY-MM-DD');
    const monthEnd = dayjs(asOf).endOf('month').format('YYYY-MM-DD');
    const prevMonthStart = dayjs(asOf).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
    const prevMonthEnd = dayjs(asOf).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');

    // ---- Subscription counters (single indexed pass) --------------------
    const subStates = db.prepare(
      'SELECT state, COUNT(*) c, COALESCE(SUM(unit_price*quantity),0) v FROM subscriptions GROUP BY state'
    ).all();
    const stateMap = Object.fromEntries(subStates.map((s) => [s.state, s.c]));

    const mrrRow = db.prepare(
      `SELECT COALESCE(SUM(${MRR_SQL}),0) mrr, COUNT(*) c
         FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
        WHERE s.state = 'active'`
    ).get();
    const mrr = round2(mrrRow.mrr);
    const activeCount = mrrRow.c;

    // ---- Money this month ------------------------------------------------
    const invoicedThisMonth = db.prepare(
      `SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM invoices
        WHERE state != 'cancelled' AND invoice_date BETWEEN ? AND ?`
    ).get(monthStart, monthEnd);

    const collectedThisMonth = db.prepare(
      `SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM payments WHERE payment_date BETWEEN ? AND ?`
    ).get(monthStart, monthEnd);

    const collectedPrev = db.prepare(
      `SELECT COALESCE(SUM(amount),0) s FROM payments WHERE payment_date BETWEEN ? AND ?`
    ).get(prevMonthStart, prevMonthEnd).s;

    const invoicedPrev = db.prepare(
      `SELECT COALESCE(SUM(total),0) s FROM invoices WHERE state != 'cancelled' AND invoice_date BETWEEN ? AND ?`
    ).get(prevMonthStart, prevMonthEnd).s;

    // ---- Receivables -----------------------------------------------------
    const receivable = db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN state='confirmed' THEN balance ELSE 0 END),0) outstanding,
         COALESCE(SUM(CASE WHEN state='confirmed' AND balance>0 THEN 1 ELSE 0 END),0) open_invoices,
         COALESCE(SUM(CASE WHEN state='confirmed' AND balance>0 AND due_date < ? THEN 1 ELSE 0 END),0) overdue_count,
         COALESCE(SUM(CASE WHEN state='confirmed' AND balance>0 AND due_date < ? THEN balance ELSE 0 END),0) overdue_amount,
         COALESCE(SUM(CASE WHEN state='draft' THEN 1 ELSE 0 END),0) draft_count
       FROM invoices`
    ).get(asOf, asOf);

    // ---- 12-month revenue trend -----------------------------------------
    const trendStart = dayjs(asOf).subtract(11, 'month').startOf('month').format('YYYY-MM-DD');
    const invByMonth = db.prepare(
      `SELECT substr(invoice_date,1,7) m, COALESCE(SUM(total),0) v, COUNT(*) c
         FROM invoices WHERE state != 'cancelled' AND invoice_date >= ? GROUP BY m`
    ).all(trendStart);
    const payByMonth = db.prepare(
      `SELECT substr(payment_date,1,7) m, COALESCE(SUM(amount),0) v
         FROM payments WHERE payment_date >= ? GROUP BY m`
    ).all(trendStart);
    const invMap = Object.fromEntries(invByMonth.map((r) => [r.m, r]));
    const payMap = Object.fromEntries(payByMonth.map((r) => [r.m, r]));
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      const d = dayjs(asOf).subtract(i, 'month');
      const key = d.format('YYYY-MM');
      trend.push({
        month: key,
        label: d.format('MMM YY'),
        invoiced: round2(invMap[key]?.v || 0),
        collected: round2(payMap[key]?.v || 0),
        invoices: invMap[key]?.c || 0,
      });
    }

    // ---- Aging buckets ---------------------------------------------------
    const openInvoices = db.prepare(
      `SELECT balance, due_date FROM invoices WHERE state='confirmed' AND balance > 0`
    ).all();
    const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const inv of openInvoices) {
      const days = dayjs(asOf).diff(dayjs(inv.due_date), 'day');
      if (days <= 0) aging.current += inv.balance;
      else if (days <= 30) aging.d1_30 += inv.balance;
      else if (days <= 60) aging.d31_60 += inv.balance;
      else if (days <= 90) aging.d61_90 += inv.balance;
      else aging.d90_plus += inv.balance;
    }
    Object.keys(aging).forEach((k) => { aging[k] = round2(aging[k]); });

    // ---- Top customers ---------------------------------------------------
    const topCustomers = db.prepare(
      `SELECT u.id, u.name, u.company_name,
              COALESCE(SUM(i.total),0) billed,
              COALESCE(SUM(i.amount_paid),0) paid,
              COALESCE(SUM(CASE WHEN i.state='confirmed' THEN i.balance ELSE 0 END),0) owed,
              (SELECT COUNT(*) FROM subscriptions s2 WHERE s2.customer_id = u.id AND s2.state='active') active_subs
         FROM users u JOIN invoices i ON i.customer_id = u.id
        WHERE u.role='customer' AND i.state != 'cancelled'
        GROUP BY u.id ORDER BY billed DESC LIMIT 8`
    ).all().map((r) => ({ ...r, billed: round2(r.billed), paid: round2(r.paid), owed: round2(r.owed) }));

    // ---- Plan mix --------------------------------------------------------
    const planMix = db.prepare(
      `SELECT pl.name, pl.billing_period, COUNT(s.id) c, COALESCE(SUM(${MRR_SQL}),0) mrr
         FROM plans pl LEFT JOIN subscriptions s ON s.plan_id = pl.id AND s.state='active'
        GROUP BY pl.id HAVING c > 0 ORDER BY c DESC LIMIT 8`
    ).all().map((r) => ({ ...r, mrr: round2(r.mrr) }));

    const methodMix = db.prepare(
      `SELECT method, COUNT(*) c, COALESCE(SUM(amount),0) amount FROM payments GROUP BY method ORDER BY amount DESC`
    ).all().map((r) => ({ ...r, amount: round2(r.amount) }));

    // ---- Movement this month --------------------------------------------
    const newSubs = db.prepare(
      "SELECT COUNT(*) c FROM subscriptions WHERE start_date BETWEEN ? AND ?"
    ).get(monthStart, monthEnd).c;
    const closedSubs = db.prepare(
      "SELECT COUNT(*) c FROM subscriptions WHERE state='closed' AND closed_at BETWEEN ? AND ?"
    ).get(monthStart, monthEnd).c;
    const paused = db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE state='paused'").get().c;

    const churnRate = activeCount + closedSubs > 0 ? round2((closedSubs / (activeCount + closedSubs)) * 100) : 0;

    res.json({
      as_of: asOf,
      kpis: {
        mrr,
        arr: round2(mrr * 12),
        active_subscriptions: activeCount,
        total_subscriptions: Object.values(stateMap).reduce((a, b) => a + b, 0),
        draft_subscriptions: stateMap.draft || 0,
        quotation_subscriptions: (stateMap.quotation || 0) + (stateMap.confirmed || 0),
        paused_subscriptions: paused,
        closed_subscriptions: stateMap.closed || 0,
        invoiced_this_month: round2(invoicedThisMonth.s),
        invoices_this_month: invoicedThisMonth.c,
        collected_this_month: round2(collectedThisMonth.s),
        payments_this_month: collectedThisMonth.c,
        invoiced_prev_month: round2(invoicedPrev),
        collected_prev_month: round2(collectedPrev),
        invoiced_change_pct: invoicedPrev > 0 ? round2(((invoicedThisMonth.s - invoicedPrev) / invoicedPrev) * 100) : null,
        collected_change_pct: collectedPrev > 0 ? round2(((collectedThisMonth.s - collectedPrev) / collectedPrev) * 100) : null,
        outstanding: round2(receivable.outstanding),
        open_invoices: receivable.open_invoices,
        overdue_count: receivable.overdue_count,
        overdue_amount: round2(receivable.overdue_amount),
        draft_invoices: receivable.draft_count,
        new_subscriptions_this_month: newSubs,
        closed_this_month: closedSubs,
        churn_rate: churnRate,
        avg_revenue_per_account: activeCount ? round2(mrr / activeCount) : 0,
      },
      states: stateMap,
      trend,
      aging,
      top_customers: topCustomers,
      plan_mix: planMix,
      method_mix: methodMix,
    });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/reports/revenue — filterable revenue register + CSV          */
/* ==================================================================== */
router.get('/revenue', internalOnly, (req, res, next) => {
  try {
    const from = req.query.from || dayjs().startOf('year').format('YYYY-MM-DD');
    const to = req.query.to || today();
    const groupBy = ['month', 'customer', 'plan', 'method'].includes(req.query.groupBy) ? req.query.groupBy : 'month';

    if (groupBy === 'customer') {
      const rows = db.prepare(
        `SELECT u.id, u.name, u.company_name,
                COALESCE(SUM(i.total),0) invoiced, COALESCE(SUM(i.amount_paid),0) paid,
                COALESCE(SUM(CASE WHEN i.state='confirmed' THEN i.balance ELSE 0 END),0) outstanding,
                COUNT(i.id) invoices
           FROM invoices i JOIN users u ON u.id = i.customer_id
          WHERE i.state != 'cancelled' AND i.invoice_date BETWEEN ? AND ?
          GROUP BY u.id ORDER BY invoiced DESC`
      ).all(from, to);
      return res.json({ groupBy, from, to, rows: rows.map(r => ({ ...r, invoiced: round2(r.invoiced), paid: round2(r.paid), outstanding: round2(r.outstanding) })) });
    }

    if (groupBy === 'plan') {
      const rows = db.prepare(
        `SELECT pl.name, pl.billing_period, COUNT(i.id) invoices, COALESCE(SUM(i.total),0) invoiced,
                COALESCE(SUM(i.amount_paid),0) paid
           FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id JOIN plans pl ON pl.id = s.plan_id
          WHERE i.state != 'cancelled' AND i.invoice_date BETWEEN ? AND ?
          GROUP BY pl.id ORDER BY invoiced DESC`
      ).all(from, to);
      return res.json({ groupBy, from, to, rows: rows.map(r => ({ ...r, invoiced: round2(r.invoiced), paid: round2(r.paid) })) });
    }

    if (groupBy === 'method') {
      const rows = db.prepare(
        `SELECT method, COUNT(*) c, COALESCE(SUM(amount),0) amount FROM payments
          WHERE payment_date BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC`
      ).all(from, to);
      return res.json({ groupBy, from, to, rows: rows.map(r => ({ ...r, amount: round2(r.amount) })) });
    }

    const rows = db.prepare(
      `SELECT substr(invoice_date,1,7) period,
              COUNT(*) invoices, COALESCE(SUM(total),0) invoiced,
              COALESCE(SUM(amount_paid),0) paid,
              COALESCE(SUM(balance),0) outstanding,
              COALESCE(SUM(tax_total),0) tax,
              COALESCE(SUM(discount_total),0) discounts
         FROM invoices WHERE state != 'cancelled' AND invoice_date BETWEEN ? AND ?
        GROUP BY period ORDER BY period`
    ).all(from, to).map((r) => ({
      ...r, invoiced: round2(r.invoiced), paid: round2(r.paid),
      outstanding: round2(r.outstanding), tax: round2(r.tax), discounts: round2(r.discounts),
    }));
    res.json({ groupBy, from, to, rows });
  } catch (e) { next(e); }
});

/* Provisioning snapshot for the "active subscriptions" report. */
router.get('/subscriptions', internalOnly, (req, res, next) => {
  try {
    const asOf = req.query.as_of || today();
    const byPeriod = db.prepare(
      `SELECT pl.billing_period, COUNT(*) c, COALESCE(SUM(${MRR_SQL}),0) mrr
         FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
        WHERE s.state='active' GROUP BY pl.billing_period`
    ).all().map((r) => ({ ...r, mrr: round2(r.mrr) }));

    const renewals = db.prepare(
      `SELECT substr(next_billing_date,1,7) m, COUNT(*) c, COALESCE(SUM(unit_price*quantity),0) v
         FROM subscriptions WHERE state='active' AND next_billing_date IS NOT NULL
        GROUP BY m ORDER BY m LIMIT 12`
    ).all();

    const expiring = db.prepare(
      `SELECT s.number, s.expiry_date, s.state, u.name AS customer_name, pl.name AS plan_name,
              pl.allow_renew, pl.close_on_end
         FROM subscriptions s JOIN users u ON u.id=s.customer_id JOIN plans pl ON pl.id=s.plan_id
        WHERE s.state='active' AND s.expiry_date <= ? ORDER BY s.expiry_date LIMIT 50`
    ).all(dayjs(asOf).add(30, 'day').format('YYYY-MM-DD'));

    res.json({ as_of: asOf, by_period: byPeriod, renewals, expiring });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/reports/receivables — who owes what, and how late            */
/* ==================================================================== */
router.get('/receivables', internalOnly, (req, res, next) => {
  try {
    const asOf = req.query.as_of || today();
    const rows = db.prepare(
      `SELECT i.id, i.number, i.invoice_date, i.due_date, i.total, i.amount_paid, i.balance,
              u.name AS customer_name, u.company_name, u.email,
              CAST(julianday(?) - julianday(i.due_date) AS INTEGER) AS days_overdue
         FROM invoices i JOIN users u ON u.id = i.customer_id
        WHERE i.state='confirmed' AND i.balance > 0
        ORDER BY days_overdue DESC, i.due_date ASC LIMIT 500`
    ).all(asOf).map((r) => ({
      ...r,
      balance: round2(r.balance),
      bucket: r.days_overdue <= 0 ? 'current' : r.days_overdue <= 30 ? '1-30' : r.days_overdue <= 60 ? '31-60' : r.days_overdue <= 90 ? '61-90' : '90+',
    }));
    res.json({ as_of: asOf, total: round2(rows.reduce((s, r) => s + r.balance, 0)), rows });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/reports/export.csv — one click for the auditor               */
/* ==================================================================== */
router.get('/export.csv', internalOnly, (req, res, next) => {
  try {
    const type = req.query.type || 'invoices';
    let header = [];
    let rows = [];
    if (type === 'invoices') {
      header = ['Number', 'Invoice Date', 'Due Date', 'Customer', 'Subscription', 'State', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance'];
      rows = db.prepare(
        `SELECT i.number, i.invoice_date, i.due_date, u.name, COALESCE(s.number,''), i.state,
                i.subtotal, i.discount_total, i.tax_total, i.total, i.amount_paid, i.balance
           FROM invoices i JOIN users u ON u.id=i.customer_id LEFT JOIN subscriptions s ON s.id=i.subscription_id
          WHERE i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date`
      ).all(req.query.from || '1970-01-01', req.query.to || '2999-12-31');
    } else if (type === 'payments') {
      header = ['Number', 'Date', 'Invoice', 'Customer', 'Method', 'Amount', 'Reference', 'Note'];
      rows = db.prepare(
        `SELECT p.number, p.payment_date, i.number, u.name, p.method, p.amount, COALESCE(p.reference,''), COALESCE(p.note,'')
           FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN users u ON u.id=p.customer_id
          WHERE p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date`
      ).all(req.query.from || '1970-01-01', req.query.to || '2999-12-31');
    } else {
      header = ['Number', 'Customer', 'Plan', 'State', 'Start', 'Expiry', 'Quantity', 'Unit Price', 'Next Billing'];
      rows = db.prepare(
        `SELECT s.number, u.name, pl.name, s.state, s.start_date, s.expiry_date, s.quantity, s.unit_price, COALESCE(s.next_billing_date,'')
           FROM subscriptions s JOIN users u ON u.id=s.customer_id JOIN plans pl ON pl.id=s.plan_id ORDER BY s.number`
      ).all();
    }

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header.join(','), ...rows.map((r) => Object.values(r).map(esc).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="brightloop-${type}-${today()}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

export default router;
