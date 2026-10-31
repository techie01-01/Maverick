import { Router } from 'express';
import { db } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import { bad, logActivity, notFound, requireFields, round2, today } from '../lib/util.js';
import { liveDiscounts } from '../lib/billing.js';

const router = Router();
router.use(authenticate);

/** Enrich with a derived status so the UI can say "expired", "exhausted", "live". */
function decorate(d, asOf = today()) {
  const products = db.prepare(
    `SELECT p.id, p.name FROM discount_products dp JOIN products p ON p.id = dp.product_id WHERE dp.discount_id = ?`
  ).all(d.id);
  let status = 'live';
  if (!d.is_active) status = 'inactive';
  else if (d.start_date && d.start_date > asOf) status = 'scheduled';
  else if (d.end_date && d.end_date < asOf) status = 'expired';
  else if (d.max_uses > 0 && d.used_count >= d.max_uses) status = 'exhausted';

  const usageAmount = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM discount_usages WHERE discount_id = ?').get(d.id).s;
  return { ...d, products, status, usage_amount: round2(usageAmount) };
}

router.get('/', internalOnly, (req, res, next) => {
  try {
    const rows = db.prepare('SELECT * FROM discounts ORDER BY created_at DESC').all().map((d) => decorate(d));
    const upcoming = liveDiscounts().map((d) => d.id);
    res.json({
      rows,
      summary: {
        total: rows.length,
        live: rows.filter((r) => r.status === 'live').length,
        expired: rows.filter((r) => r.status === 'expired').length,
        exhausted: rows.filter((r) => r.status === 'exhausted').length,
        saving: round2(rows.reduce((s, r) => s + r.usage_amount, 0)),
      },
    });
  } catch (e) { next(e); }
});

router.get('/:id', internalOnly, (req, res, next) => {
  try {
    const d = db.prepare('SELECT * FROM discounts WHERE id = ?').get(Number(req.params.id));
    if (!d) throw notFound('Discount not found');
    const out = decorate(d);
    out.usages = db.prepare(
      `SELECT du.*, i.number AS invoice_number, u.name AS customer_name
         FROM discount_usages du
         LEFT JOIN invoices i ON i.id = du.invoice_id
         LEFT JOIN users u ON u.id = du.customer_id
        WHERE du.discount_id = ? ORDER BY du.applied_on DESC`
    ).all(d.id);
    res.json({ row: out });
  } catch (e) { next(e); }
});

/* ONLY the admin may create or change discount rules. */
router.post('/', adminOnly, (req, res, next) => {
  try {
    const {
      code, name, kind = 'percent', value, min_purchase = 0, min_quantity = 0,
      start_date, end_date, max_uses = 0, applies_to = 'subscription', product_ids = [], scope_note,
    } = req.body || {};
    requireFields(req.body, ['code', 'name', 'value']);
    if (!['percent', 'fixed'].includes(kind)) throw bad('Discount type must be percentage or fixed amount.');
    if (kind === 'percent' && (value <= 0 || value > 100)) throw bad('A percentage discount must be between 0 and 100.');
    if (kind === 'fixed' && value <= 0) throw bad('A fixed discount must be greater than zero.');
    if (start_date && end_date && end_date < start_date) throw bad('The end date must be after the start date.');
    if (applies_to === 'products' && !product_ids.length) throw bad('Pick at least one product for a product-level discount.');
    if (db.prepare('SELECT id FROM discounts WHERE code = ?').get(code)) throw bad('That discount code is already in use.');

    const id = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO discounts (code, name, kind, value, min_purchase, min_quantity, start_date, end_date,
           max_uses, applies_to, scope_note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        String(code).toUpperCase().trim(), name.trim(), kind, round2(value), round2(min_purchase),
        Math.max(0, min_quantity), start_date || null, end_date || null, Math.max(0, max_uses),
        applies_to, scope_note || null, req.user.id
      );
      const did = info.lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO discount_products (discount_id, product_id) VALUES (?,?)');
      for (const pid of product_ids) ins.run(did, pid);
      return did;
    })();

    logActivity(req.user, 'discount.create', 'discount', id, `Discount "${name}" (${kind} ${value}) created`);
    res.status(201).json({ row: decorate(db.prepare('SELECT * FROM discounts WHERE id = ?').get(id)) });
  } catch (e) { next(e); }
});

router.patch('/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const d = db.prepare('SELECT * FROM discounts WHERE id = ?').get(id);
    if (!d) throw notFound('Discount not found');

    db.transaction(() => {
      const fields = ['name', 'kind', 'value', 'min_purchase', 'min_quantity', 'start_date', 'end_date',
        'max_uses', 'applies_to', 'scope_note', 'is_active'];
      const sets = []; const params = [];
      for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
      if (sets.length) {
        sets.push("updated_at = datetime('now')");
        db.prepare(`UPDATE discounts SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      }
      if (Array.isArray(req.body.product_ids)) {
        db.prepare('DELETE FROM discount_products WHERE discount_id = ?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO discount_products (discount_id, product_id) VALUES (?,?)');
        for (const pid of req.body.product_ids) ins.run(id, pid);
      }
    })();
    logActivity(req.user, 'discount.update', 'discount', id, `Discount "${d.name}" updated`);
    res.json({ row: decorate(db.prepare('SELECT * FROM discounts WHERE id = ?').get(id)) });
  } catch (e) { next(e); }
});

router.delete('/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const d = db.prepare('SELECT * FROM discounts WHERE id = ?').get(id);
    if (!d) throw notFound('Discount not found');
    if (d.used_count > 0) throw bad('This discount has already been used. Deactivate it instead of deleting.');
    db.prepare('DELETE FROM discounts WHERE id = ?').run(id);
    logActivity(req.user, 'discount.delete', 'discount', id, `Discount "${d.name}" deleted`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* Live preview: "what would this customer save right now?" */
router.post('/preview', internalOnly, (req, res, next) => {
  try {
    const { subtotal = 0, quantity = 1, as_of = today(), product_ids = [] } = req.body || {};
    const rules = liveDiscounts(as_of);
    const results = rules.map((r) => {
      const qualifies =
        (r.min_purchase === 0 || subtotal >= r.min_purchase) &&
        (r.min_quantity === 0 || quantity >= r.min_quantity) &&
        (r.applies_to !== 'products' || db.prepare(
          `SELECT COUNT(*) c FROM discount_products WHERE discount_id = ? AND product_id IN (${product_ids.length ? product_ids.map(() => '?').join(',') : 'NULL'})`
        ).get(r.id, ...product_ids).c > 0);
      const raw = r.kind === 'percent' ? (subtotal * r.value) / 100 : r.value;
      return { ...r, qualifies, saving: qualifies ? round2(Math.min(raw, subtotal)) : 0 };
    }).sort((a, b) => b.saving - a.saving);
    res.json({ rows: results, best: results.find((r) => r.qualifies) || null });
  } catch (e) { next(e); }
});

export default router;
