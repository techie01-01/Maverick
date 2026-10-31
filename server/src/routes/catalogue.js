import { Router } from 'express';
import { db } from '../db.js';
import { adminOnly, authenticate, internalOnly } from '../lib/auth.js';
import { bad, logActivity, notFound, paged, parsePaging, requireFields, round2 } from '../lib/util.js';

const router = Router();
// Internal team reads the catalogue; only the admin may change it.
router.use(authenticate);

/* ==================================================================== */
/* TAXES                                                                 */
/* ==================================================================== */
router.get('/taxes', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT * FROM taxes ORDER BY is_active DESC, rate DESC, name').all();
    res.json({ rows });
  } catch (e) { next(e); }
});

router.post('/taxes', adminOnly, (req, res, next) => {
  try {
    const { name, code, rate = 0, kind = 'percent', fixed_amount = 0, applies_to = 'all', included_in_price = 0, country } = req.body || {};
    requireFields(req.body, ['name']);
    const info = db.prepare(
      `INSERT INTO taxes (name, code, rate, kind, fixed_amount, applies_to, included_in_price, country)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(name, code || null, round2(rate), kind, round2(fixed_amount), applies_to, included_in_price ? 1 : 0, country || null);
    logActivity(req.user, 'tax.create', 'tax', info.lastInsertRowid, `Tax rule "${name}" created`);
    res.status(201).json({ row: db.prepare('SELECT * FROM taxes WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.patch('/taxes/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tax = db.prepare('SELECT * FROM taxes WHERE id = ?').get(id);
    if (!tax) throw notFound('Tax rule not found');
    const fields = ['name', 'code', 'rate', 'kind', 'fixed_amount', 'applies_to', 'included_in_price', 'country', 'is_active'];
    const sets = []; const params = [];
    for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
    if (!sets.length) throw bad('Nothing to update.');
    db.prepare(`UPDATE taxes SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    logActivity(req.user, 'tax.update', 'tax', id, `Tax rule "${tax.name}" updated`);
    res.json({ row: db.prepare('SELECT * FROM taxes WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.delete('/taxes/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT COUNT(*) c FROM product_taxes WHERE tax_id = ?').get(id).c;
    if (used) throw bad('This tax rule is used by a product. Deactivate it instead of deleting.');
    db.prepare('DELETE FROM taxes WHERE id = ?').run(id);
    logActivity(req.user, 'tax.delete', 'tax', id, 'Tax rule deleted');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* PRODUCTS + VARIANTS                                                   */
/* ==================================================================== */
router.get('/products', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 24);
    const q = (req.query.q || '').trim();
    const type = req.query.type;
    const where = []; const params = [];
    if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.notes LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (type) { where.push('p.type = ?'); params.push(type); }
    if (req.query.active !== undefined && req.query.active !== '') { where.push('p.is_active = ?'); params.push(req.query.active === 'true' ? 1 : 0); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM products p ${w}`).get(...params).c;
    const rows = db.prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
              (SELECT COUNT(*) FROM plans pl WHERE pl.product_id = p.id) AS plan_count,
              (SELECT GROUP_CONCAT(t.name, ', ') FROM product_taxes pt JOIN taxes t ON t.id = pt.tax_id WHERE pt.product_id = p.id) AS tax_names
         FROM products p ${w}
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const variants = rows.length
      ? db.prepare(
          `SELECT * FROM product_variants WHERE product_id IN (${rows.map(() => '?').join(',')}) ORDER BY attribute_value`
        ).all(...rows.map((r) => r.id))
      : [];
    const byProduct = variants.reduce((acc, v) => {
      (acc[v.product_id] ||= []).push(v); return acc;
    }, {});

    res.json(paged(rows.map((r) => ({ ...r, variants: byProduct[r.id] || [] })), total, page, limit));
  } catch (e) { next(e); }
});

router.get('/products/:id', (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
    if (!row) throw notFound('Product not found');
    row.variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY attribute_value').all(row.id);
    row.taxes = db.prepare('SELECT t.* FROM taxes t JOIN product_taxes pt ON pt.tax_id = t.id WHERE pt.product_id = ?').all(row.id);
    row.plans = db.prepare('SELECT * FROM plans WHERE product_id = ? ORDER BY name').all(row.id);
    res.json({ row });
  } catch (e) { next(e); }
});

router.post('/products', adminOnly, (req, res, next) => {
  try {
    const { name, sku, type = 'service', sales_price = 0, cost_price = 0, notes, variants = [], tax_ids = [] } = req.body || {};
    requireFields(req.body, ['name']);
    const info = db.transaction(() => {
      const i = db.prepare(
        `INSERT INTO products (name, sku, type, sales_price, cost_price, notes) VALUES (?,?,?,?,?,?)`
      ).run(name.trim(), sku || null, type, round2(sales_price), round2(cost_price), notes || null);
      const pid = i.lastInsertRowid;
      const insV = db.prepare(
        'INSERT INTO product_variants (product_id, attribute_name, attribute_value, price_extra) VALUES (?,?,?,?)'
      );
      for (const v of variants) {
        if (!v.attribute_value) continue;
        insV.run(pid, v.attribute_name || 'Brand', v.attribute_value, round2(v.price_extra));
      }
      const insT = db.prepare('INSERT OR IGNORE INTO product_taxes (product_id, tax_id) VALUES (?,?)');
      for (const t of tax_ids) insT.run(pid, t);
      return pid;
    })();
    logActivity(req.user, 'product.create', 'product', info, `Product "${name}" created`);
    res.status(201).json({ row: db.prepare('SELECT * FROM products WHERE id = ?').get(info) });
  } catch (e) { next(e); }
});

router.patch('/products/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) throw notFound('Product not found');

    db.transaction(() => {
      const fields = ['name', 'sku', 'type', 'sales_price', 'cost_price', 'notes', 'is_active'];
      const sets = []; const params = [];
      for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
      if (sets.length) {
        sets.push("updated_at = datetime('now')");
        db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      }
      if (Array.isArray(req.body.variants)) {
        db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
        const insV = db.prepare(
          'INSERT INTO product_variants (product_id, attribute_name, attribute_value, price_extra) VALUES (?,?,?,?)'
        );
        for (const v of req.body.variants) {
          if (!v.attribute_value) continue;
          insV.run(id, v.attribute_name || 'Brand', v.attribute_value, round2(v.price_extra));
        }
      }
      if (Array.isArray(req.body.tax_ids)) {
        db.prepare('DELETE FROM product_taxes WHERE product_id = ?').run(id);
        const insT = db.prepare('INSERT OR IGNORE INTO product_taxes (product_id, tax_id) VALUES (?,?)');
        for (const t of req.body.tax_ids) insT.run(id, t);
      }
    })();
    logActivity(req.user, 'product.update', 'product', id, `Product "${product.name}" updated`);
    res.json({ row: db.prepare('SELECT * FROM products WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.delete('/products/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const planCount = db.prepare('SELECT COUNT(*) c FROM plans WHERE product_id = ?').get(id).c;
    if (planCount) throw bad('This product is used by a plan. Deactivate it instead of deleting.');
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    logActivity(req.user, 'product.delete', 'product', id, 'Product deleted');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* PLANS                                                                 */
/* ==================================================================== */
router.get('/plans', (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const where = []; const params = [];
    if (q) { where.push('(pl.name LIKE ? OR pl.code LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (req.query.billing_period) { where.push('pl.billing_period = ?'); params.push(req.query.billing_period); }
    if (req.query.active !== undefined && req.query.active !== '') { where.push('pl.is_active = ?'); params.push(req.query.active === 'true' ? 1 : 0); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT pl.*, p.name AS product_name, p.type AS product_type,
              (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = pl.id AND s.state = 'active') AS active_subs
         FROM plans pl JOIN products p ON p.id = pl.product_id
         ${w} ORDER BY pl.created_at DESC`
    ).all(...params);
    res.json({ rows });
  } catch (e) { next(e); }
});

router.get('/plans/:id', (req, res, next) => {
  try {
    const row = db.prepare(
      'SELECT pl.*, p.name AS product_name FROM plans pl JOIN products p ON p.id = pl.product_id WHERE pl.id = ?'
    ).get(Number(req.params.id));
    if (!row) throw notFound('Plan not found');
    res.json({ row });
  } catch (e) { next(e); }
});

router.post('/plans', adminOnly, (req, res, next) => {
  try {
    const {
      name, code, product_id, billing_period = 'monthly', interval_count = 1, price = 0,
      min_quantity = 1, available_from, available_to, allow_close = 1, allow_pause = 1,
      allow_renew = 1, close_on_end = 1, max_renewals = 0, trial_days = 0, notes,
    } = req.body || {};
    requireFields(req.body, ['name', 'product_id']);
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(billing_period)) throw bad('Billing period must be daily, weekly, monthly or yearly.');
    if (available_from && available_to && available_from > available_to) throw bad('The availability end date must be after the start date.');
    const info = db.prepare(
      `INSERT INTO plans (name, code, product_id, billing_period, interval_count, price, min_quantity,
        available_from, available_to, allow_close, allow_pause, allow_renew, close_on_end, max_renewals, trial_days, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      name.trim(), code || null, product_id, billing_period, Math.max(1, interval_count), round2(price),
      Math.max(1, min_quantity), available_from || null, available_to || null,
      allow_close ? 1 : 0, allow_pause ? 1 : 0, allow_renew ? 1 : 0, close_on_end ? 1 : 0,
      Math.max(0, max_renewals), Math.max(0, trial_days), notes || null
    );
    logActivity(req.user, 'plan.create', 'plan', info.lastInsertRowid, `Plan "${name}" created`);
    res.status(201).json({ row: db.prepare('SELECT * FROM plans WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.patch('/plans/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
    if (!plan) throw notFound('Plan not found');
    const fields = ['name', 'code', 'product_id', 'billing_period', 'interval_count', 'price', 'min_quantity',
      'available_from', 'available_to', 'allow_close', 'allow_pause', 'allow_renew', 'close_on_end',
      'max_renewals', 'trial_days', 'notes', 'is_active'];
    const sets = []; const params = [];
    for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
    if (!sets.length) throw bad('Nothing to update.');
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    logActivity(req.user, 'plan.update', 'plan', id, `Plan "${plan.name}" updated`);
    res.json({ row: db.prepare('SELECT * FROM plans WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.delete('/plans/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT COUNT(*) c FROM subscriptions WHERE plan_id = ?').get(id).c;
    if (used) throw bad('This plan already has subscriptions. Deactivate it instead of deleting.');
    db.prepare('DELETE FROM plans WHERE id = ?').run(id);
    logActivity(req.user, 'plan.delete', 'plan', id, 'Plan deleted');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================================================================== */
/* QUOTATION TEMPLATES                                                   */
/* ==================================================================== */
router.get('/quotation-templates', (_req, res, next) => {
  try {
    const rows = db.prepare(
      `SELECT qt.*, pl.name AS plan_name, pl.billing_period, pl.price AS plan_price
         FROM quotation_templates qt LEFT JOIN plans pl ON pl.id = qt.plan_id
        ORDER BY qt.created_at DESC`
    ).all();
    const lines = db.prepare(
      `SELECT l.*, p.name AS product_name FROM quotation_template_lines l
        LEFT JOIN products p ON p.id = l.product_id`
    ).all();
    const grouped = lines.reduce((acc, l) => { (acc[l.template_id] ||= []).push(l); return acc; }, {});
    res.json({ rows: rows.map((r) => ({ ...r, lines: grouped[r.id] || [] })) });
  } catch (e) { next(e); }
});

router.post('/quotation-templates', adminOnly, (req, res, next) => {
  try {
    const { name, plan_id, validity_days = 30, payment_term = 'net30', quantity = 1, notes, lines = [] } = req.body || {};
    requireFields(req.body, ['name']);
    const id = db.transaction(() => {
      const i = db.prepare(
        `INSERT INTO quotation_templates (name, plan_id, validity_days, payment_term, quantity, notes)
         VALUES (?,?,?,?,?,?)`
      ).run(name.trim(), plan_id || null, Math.max(1, validity_days), payment_term, Math.max(1, quantity), notes || null);
      const tl = i.lastInsertRowid;
      const ins = db.prepare(
        `INSERT INTO quotation_template_lines (template_id, product_id, variant_id, label, quantity, unit_price, discount_pct)
         VALUES (?,?,?,?,?,?,?)`
      );
      for (const l of lines) ins.run(tl, l.product_id, l.variant_id || null, l.label || null, l.quantity || 1, round2(l.unit_price), round2(l.discount_pct || 0));
      return tl;
    })();
    logActivity(req.user, 'template.create', 'quotation_template', id, `Quotation template "${name}" created`);
    res.status(201).json({ row: db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.patch('/quotation-templates/:id', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tpl = db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(id);
    if (!tpl) throw notFound('Template not found');
    db.transaction(() => {
      const fields = ['name', 'plan_id', 'validity_days', 'payment_term', 'quantity', 'notes', 'is_active'];
      const sets = []; const params = [];
      for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
      if (sets.length) db.prepare(`UPDATE quotation_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      if (Array.isArray(req.body.lines)) {
        db.prepare('DELETE FROM quotation_template_lines WHERE template_id = ?').run(id);
        const ins = db.prepare(
          `INSERT INTO quotation_template_lines (template_id, product_id, variant_id, label, quantity, unit_price, discount_pct)
           VALUES (?,?,?,?,?,?,?)`
        );
        for (const l of req.body.lines) ins.run(id, l.product_id, l.variant_id || null, l.label || null, l.quantity || 1, round2(l.unit_price), round2(l.discount_pct || 0));
      }
    })();
    logActivity(req.user, 'template.update', 'quotation_template', id, `Template "${tpl.name}" updated`);
    res.json({ row: db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(id) });
  } catch (e) { next(e); }
});

router.delete('/quotation-templates/:id', adminOnly, (req, res, next) => {
  try {
    db.prepare('DELETE FROM quotation_templates WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
