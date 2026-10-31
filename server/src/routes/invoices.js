import { Router } from 'express';
import dayjs from 'dayjs';
import { db, getSetting } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import {
  ApiError, bad, logActivity, money, notFound, paged, parsePaging, queueMail, requireFields, round2, settingsSnapshot, today,
} from '../lib/util.js';

const router = Router();
router.use(authenticate);

/* ==================================================================== */
/* GET /api/invoices                                                     */
/* ==================================================================== */
router.get('/', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 20);
    const where = [];
    const params = [];
    const isCustomer = req.user.role === 'customer';
    if (isCustomer) { where.push('i.customer_id = ?'); params.push(req.user.id); }

    if (req.query.state) {
      const states = String(req.query.state).split(',').filter(Boolean);
      where.push(`i.state IN (${states.map(() => '?').join(',')})`);
      params.push(...states);
    }
    // Derived views the finance team cares about.
    if (req.query.status === 'outstanding') where.push("i.state = 'confirmed' AND i.balance > 0");
    if (req.query.status === 'overdue') {
      where.push("i.state = 'confirmed' AND i.balance > 0 AND i.due_date < ?");
      params.push(today());
    }
    if (req.query.status === 'paid') where.push("i.state = 'paid'");

    const q = (req.query.q || '').trim();
    if (q) {
      where.push('(i.number LIKE ? OR u.name LIKE ? OR u.company_name LIKE ? OR u.email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.customer_id) { where.push('i.customer_id = ?'); params.push(Number(req.query.customer_id)); }
    if (req.query.from) { where.push('i.invoice_date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('i.invoice_date <= ?'); params.push(req.query.to); }
    if (req.query.subscription_id) { where.push('i.subscription_id = ?'); params.push(Number(req.query.subscription_id)); }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM invoices i JOIN users u ON u.id = i.customer_id LEFT JOIN subscriptions s ON s.id = i.subscription_id ${w}`;
    const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...params).c;

    const sort = ['invoice_date', 'due_date', 'total', 'number'].includes(req.query.sort) ? req.query.sort : 'invoice_date';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

    const rows = db.prepare(
      `SELECT i.*, u.name AS customer_name, u.company_name, u.email AS customer_email,
              s.number AS subscription_number,
              CASE WHEN i.state='confirmed' AND i.balance > 0 AND i.due_date < '${today()}'
                   THEN 1 ELSE 0 END AS is_overdue
         ${base} ORDER BY i.${sort} ${dir}, i.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    // KPI strip for the invoice list header.
    const agg = db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN i.state='draft' THEN 1 ELSE 0 END),0) draft_count,
         COALESCE(SUM(CASE WHEN i.state='confirmed' THEN 1 ELSE 0 END),0) open_count,
         COALESCE(SUM(CASE WHEN i.state='paid' THEN 1 ELSE 0 END),0) paid_count,
         COALESCE(SUM(CASE WHEN i.state='confirmed' THEN i.balance ELSE 0 END),0) outstanding,
         COALESCE(SUM(CASE WHEN i.state='confirmed' AND i.balance>0 AND i.due_date < '${today()}' THEN i.balance ELSE 0 END),0) overdue,
         COALESCE(SUM(CASE WHEN i.state!='cancelled' THEN i.total ELSE 0 END),0) billed
       FROM invoices i ${isCustomer ? 'WHERE i.customer_id = ?' : ''}`
    ).get(...(isCustomer ? [req.user.id] : []));

    res.json({ ...paged(rows, total, page, limit), summary: agg });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* GET /api/invoices/:id — full detail for the screen + print view       */
/* ==================================================================== */
router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = db.prepare(
      `SELECT i.*, u.name AS customer_name, u.email AS customer_email, u.company_name,
              u.address AS customer_address, u.city AS customer_city, u.country AS customer_country,
              u.tax_id AS customer_tax_id, u.phone AS customer_phone,
              s.number AS subscription_number
         FROM invoices i
         JOIN users u ON u.id = i.customer_id
         LEFT JOIN subscriptions s ON s.id = i.subscription_id
        WHERE i.id = ?`
    ).get(id);
    if (!inv) throw notFound('Invoice not found');
    if (req.user.role === 'customer' && inv.customer_id !== req.user.id) throw new ApiError(403, 'This invoice belongs to another account.');

    inv.lines = db.prepare(
      `SELECT l.*, p.name AS product_name, v.attribute_value AS variant_name
         FROM invoice_lines l
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id
        WHERE l.invoice_id = ? ORDER BY l.id`
    ).all(id).map((l) => ({ ...l, tax_ids: safeJson(l.tax_ids) }));

    inv.taxes = db.prepare('SELECT * FROM invoice_taxes WHERE invoice_id = ? ORDER BY rate DESC').all(id);
    inv.payments = db.prepare(
      `SELECT p.*, us.name AS recorded_by FROM payments p LEFT JOIN users us ON us.id = p.created_by
        WHERE p.invoice_id = ? ORDER BY p.payment_date`
    ).all(id);
    inv.company = settingsSnapshot();
    inv.amount_in_words = inWords(inv.total);

    res.json({ row: inv });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* State transitions: confirm / cancel / send                            */
/* ==================================================================== */
router.post('/:id/confirm', internalOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!inv) throw notFound('Invoice not found');
    if (inv.state !== 'draft') throw bad(`Only a draft invoice can be confirmed (this one is ${inv.state}).`);
    db.prepare("UPDATE invoices SET state='confirmed', confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    logActivity(req.user, 'invoice.confirm', 'invoice', id, `${inv.number} confirmed — ${money(inv.total)} payable`);
    res.json({ row: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.post('/:id/cancel', internalOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!inv) throw notFound('Invoice not found');
    if (inv.state === 'cancelled') throw bad('This invoice is already cancelled.');
    if (inv.state === 'paid') throw bad('A paid invoice cannot be cancelled. Record a refund instead.');
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(id).s;
    if (paid > 0) throw bad('Payments are recorded against this invoice. Remove them before cancelling.');

    db.prepare("UPDATE invoices SET state='cancelled', cancelled_at = datetime('now'), balance = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    // Free the billing period so it can be re-issued.
    logActivity(req.user, 'invoice.cancel', 'invoice', id, `${inv.number} cancelled — ${req.body?.reason || 'no reason given'}`);
    res.json({ row: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.post('/:id/send', internalOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!inv) throw notFound('Invoice not found');
    if (inv.state === 'draft') throw bad('Confirm the invoice before sending it to the customer.');
    if (inv.state === 'cancelled') throw bad('A cancelled invoice cannot be sent.');

    const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(inv.customer_id);
    queueMail({
      to: customer.email,
      subject: `Invoice ${inv.number} from ${getSetting('company_name')} — ${money(inv.balance)} due`,
      body:
        `Hi ${customer.name},\n\nInvoice ${inv.number} is attached below in summary.\n\n` +
        `Amount: ${money(inv.total)}\nPaid: ${money(inv.amount_paid)}\nBalance: ${money(inv.balance)}\n` +
        `Due date: ${inv.due_date}\n\nYou can view and settle it in your Brightloop portal.\n`,
      category: 'invoice',
      meta: { invoice_id: id },
    });
    db.prepare("UPDATE invoices SET sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    logActivity(req.user, 'invoice.send', 'invoice', id, `${inv.number} emailed to ${customer.email}`);
    res.json({ row: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id), message: `Invoice emailed to ${customer.email}` });
  } catch (e) { next(e); }
});

/* Batch confirm: the billing team's morning routine. */
router.post('/batch/confirm', internalOnly, (req, res, next) => {
  try {
    const { ids } = req.body || {};
    const list = Array.isArray(ids) && ids.length ? ids : db.prepare("SELECT id FROM invoices WHERE state='draft'").all().map((r) => r.id);
    const stmt = db.prepare("UPDATE invoices SET state='confirmed', confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND state='draft'");
    let confirmed = 0;
    db.transaction(() => {
      for (const id of list) confirmed += stmt.run(id).changes;
    })();
    logActivity(req.user, 'invoice.batch_confirm', 'invoice', null, `${confirmed} draft invoice(s) confirmed`);
    res.json({ confirmed });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* Manual invoice creation (one-off charges, not from a subscription)    */
/* ==================================================================== */
router.post('/', internalOnly, (req, res, next) => {
  try {
    const { customer_id, invoice_date = today(), due_date, payment_term = 'net30', lines = [], notes } = req.body || {};
    requireFields(req.body, ['customer_id']);
    const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(customer_id));
    if (!customer) throw bad('Select a valid customer.');
    if (!lines.length) throw bad('An invoice needs at least one line.');

    const termDays = { immediate: 0, net7: 7, net15: 15, net30: 30, net45: 45, net60: 60 };
    const due = due_date || dayjs(invoice_date).add(termDays[payment_term] ?? 30, 'day').format('YYYY-MM-DD');
    const r2 = round2;

    const computed = lines.map((l) => {
      const qty = Number(l.quantity) || 1;
      const price = r2(l.unit_price);
      const gross = r2(qty * price);
      const disc = r2(l.discount_amount || 0);
      const taxRate = r2(l.tax_rate || 0);
      const net = r2(gross - disc);
      const tax = r2((net * taxRate) / 100);
      return { ...l, qty, price, gross, disc, net, taxRate, tax, amount: r2(net + tax) };
    });
    const subtotal = r2(computed.reduce((s, l) => s + l.gross, 0));
    const discountTotal = r2(computed.reduce((s, l) => s + l.disc, 0));
    const taxTotal = r2(computed.reduce((s, l) => s + l.tax, 0));
    const total = r2(subtotal - discountTotal + taxTotal);

    const id = db.transaction(() => {
      const number = db.nextNumber('invoice', getSetting('invoice_prefix', 'INV'));
      const i = db.prepare(
        `INSERT INTO invoices (number, customer_id, state, invoice_date, due_date, subtotal, discount_total, tax_total, total, balance, notes, created_by)
         VALUES (?,?,'draft',?,?,?,?,?,?,?,?,?)`
      ).run(number, customer.id, invoice_date, due, subtotal, discountTotal, taxTotal, total, total, notes || null, req.user.id);
      const iid = i.lastInsertRowid;
      const ins = db.prepare(
        `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price, discount_amount, tax_rate, tax_amount, amount)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      for (const l of computed) ins.run(iid, l.product_id || null, l.description || 'Item', l.qty, l.price, l.disc, l.taxRate, l.tax, l.amount);
      return iid;
    })();

    logActivity(req.user, 'invoice.create', 'invoice', id, `Manual invoice for ${customer.name} — ${money(total)}`);
    res.status(201).json({ row: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* DELETE draft invoice                                                  */
/* ==================================================================== */
router.delete('/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!inv) throw notFound('Invoice not found');
    if (inv.state !== 'draft') throw bad('Only draft invoices can be deleted — cancel the others instead.');
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    logActivity(req.user, 'invoice.delete', 'invoice', id, `${inv.number} deleted`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const safeJson = (s) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };

/* Indian-format amount in words, used on the printed invoice. */
function inWords(num) {
  const n = Math.round(Number(num) || 0);
  if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`);
  const parts = [];
  const crore = Math.floor(n / 10000000); const rem1 = n % 10000000;
  const lakh = Math.floor(rem1 / 100000); const rem2 = rem1 % 100000;
  const thousand = Math.floor(rem2 / 1000); const rem3 = rem2 % 1000;
  const hundred = Math.floor(rem3 / 100); const rest = rem3 % 100;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (hundred) parts.push(`${ones[hundred]} Hundred`);
  if (rest) parts.push(two(rest));
  return `${parts.join(' ')} Rupees Only`;
}

export default router;
