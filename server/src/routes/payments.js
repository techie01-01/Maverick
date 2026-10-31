import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import {
  ApiError, bad, logActivity, money, notFound, paged, parsePaging, queueMail, requireFields, round2, today,
} from '../lib/util.js';

const router = Router();
router.use(authenticate);

export const PAYMENT_METHODS = [
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Credit / debit card' },
  { id: 'cash', label: 'Cash' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'razorpay', label: 'Razorpay' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'adjustment', label: 'Write-off / adjustment' },
];

/* ==================================================================== */
/* GET /api/payments                                                     */
/* ==================================================================== */
router.get('/', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 20);
    const where = []; const params = [];
    if (req.user.role === 'customer') { where.push('p.customer_id = ?'); params.push(req.user.id); }
    if (req.query.method) { where.push('p.method = ?'); params.push(req.query.method); }
    if (req.query.from) { where.push('p.payment_date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('p.payment_date <= ?'); params.push(req.query.to); }
    if (req.query.q) {
      where.push('(p.number LIKE ? OR i.number LIKE ? OR u.name LIKE ? OR p.reference LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = p.customer_id ${w}`;
    const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...params).c;
    const rows = db.prepare(
      `SELECT p.*, i.number AS invoice_number, i.total AS invoice_total, u.name AS customer_name,
              u.company_name, us.name AS recorded_by
         ${base} LEFT JOIN users us ON us.id = p.created_by
        ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const sums = db.prepare(
      `SELECT COALESCE(SUM(p.amount),0) total, COUNT(*) c ${base}`
    ).get(...params);

    const byMethod = db.prepare(
      `SELECT p.method, COUNT(*) c, COALESCE(SUM(p.amount),0) amount ${base} GROUP BY p.method ORDER BY amount DESC`
    ).all(...params);

    res.json({ ...paged(rows, total, page, limit), summary: { ...sums, byMethod } });
  } catch (e) { next(e); }
});

router.get('/methods', (_req, res) => res.json({ rows: PAYMENT_METHODS }));

/* ==================================================================== */
/* POST /api/payments — record a payment against an invoice              */
/* ==================================================================== */
router.post('/', internalOnly, (req, res, next) => {
  try {
    const { invoice_id, amount, method = 'bank_transfer', payment_date = today(), note, reference } = req.body || {};
    requireFields(req.body, ['invoice_id', 'amount']);
    const amt = round2(amount);
    if (amt <= 0) throw bad('The payment amount must be greater than zero.');

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(invoice_id));
    if (!inv) throw bad('Select a valid invoice.');
    if (inv.state === 'draft') throw bad('Confirm the invoice before recording a payment against it.');
    if (inv.state === 'cancelled') throw bad('Cannot record a payment against a cancelled invoice.');
    if (inv.state === 'paid') throw bad('This invoice is already fully paid.');

    const alreadyPaid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
    const balance = round2(inv.total - alreadyPaid);
    if (amt > balance + 0.01) throw bad(`That is more than the outstanding balance of ${money(balance)}.`);

    const result = db.transaction(() => {
      const number = db.nextNumber('payment', getSetting('payment_prefix', 'PAY'));
      const info = db.prepare(
        `INSERT INTO payments (number, invoice_id, customer_id, method, amount, payment_date, reference, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(number, inv.id, inv.customer_id, method, amt, payment_date, reference || null, note || null, req.user.id);

      const newPaid = round2(alreadyPaid + amt);
      const newBalance = round2(inv.total - newPaid);
      const fullyPaid = newBalance <= 0.01;
      db.prepare(
        `UPDATE invoices SET amount_paid = ?, balance = ?, state = ?, paid_at = ?,
           updated_at = datetime('now') WHERE id = ?`
      ).run(
        newPaid, fullyPaid ? 0 : newBalance,
        fullyPaid ? 'paid' : inv.state,
        fullyPaid ? new Date().toISOString() : null,
        inv.id
      );
      return { paymentId: info.lastInsertRowid, number, newPaid, newBalance, fullyPaid };
    })();

    const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(inv.customer_id);
    queueMail({
      to: customer.email,
      subject: `Payment received — ${inv.number}`,
      body: `Hi ${customer.name},\n\nWe have received ${money(amt)} by ${String(method).replace('_', ' ')} against invoice ${inv.number}.\n` +
        `Remaining balance: ${money(result.newBalance)}\n\nThank you!`,
      category: 'payment_receipt',
      meta: { invoice_id: inv.id, payment_id: result.paymentId },
    });

    logActivity(req.user, 'payment.create', 'payment', result.paymentId,
      `${money(amt)} received for ${inv.number} via ${method}${result.fullyPaid ? ' — invoice settled' : ''}`);

    res.status(201).json({
      row: db.prepare('SELECT * FROM payments WHERE id = ?').get(result.paymentId),
      invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id),
      fully_paid: result.fullyPaid,
    });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* DELETE /api/payments/:id — reversal                                   */
/* ==================================================================== */
router.delete('/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!pay) throw notFound('Payment not found');
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(pay.invoice_id);

    db.transaction(() => {
      db.prepare('DELETE FROM payments WHERE id = ?').run(id);
      const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
      const balance = round2(inv.total - paid);
      const state = inv.state === 'cancelled' ? 'cancelled' : paid > 0 ? 'confirmed' : 'confirmed';
      db.prepare(
        `UPDATE invoices SET amount_paid = ?, balance = ?, state = ?, paid_at = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(round2(paid), balance, state, inv.id);
    })();

    logActivity(req.user, 'payment.delete', 'payment', id, `${pay.number} reversed — ${money(pay.amount)} on ${inv.number}`);
    res.json({ ok: true, invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id) });
  } catch (e) { next(e); }
});

export default router;
