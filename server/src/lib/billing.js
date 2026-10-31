import dayjs from 'dayjs';
import { db, getSetting } from '../db.js';
import { addCycle, dueDateFor, round2, today, logActivity, queueMail, money } from './util.js';

/* ==================================================================== */
/* TAX ENGINE                                                           */
/* ==================================================================== */

/**
 * Default taxes for a product, taken from the admin-configured tax rules.
 * A rule only applies if it is active and its "applies to" matches the
 * product type (service / goods / digital / all).
 */
export function defaultTaxesForProduct(product) {
  if (!product) return [];
  const rows = db
    .prepare(
      `SELECT t.* FROM taxes t
         JOIN product_taxes pt ON pt.tax_id = t.id
        WHERE pt.product_id = ?
          AND t.is_active = 1
          AND (t.applies_to = 'all' OR t.applies_to = ?)
        ORDER BY t.rate DESC`
    )
    .all(product.id, product.type || 'all');
  return rows;
}

export function taxesByIds(ids) {
  if (!ids || !ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM taxes WHERE id IN (${placeholders}) AND is_active = 1`).all(...ids);
}

export function taxRateOf(taxRows) {
  return round2(taxRows.reduce((s, t) => s + Number(t.rate || 0), 0));
}

/* ==================================================================== */
/* DISCOUNT ENGINE                                                      */
/* ==================================================================== */

const discountProductIds = (discountId) =>
  db.prepare('SELECT product_id FROM discount_products WHERE discount_id = ?').all(discountId).map((r) => r.product_id);

/**
 * All discount rules that are live on a given date and still have uses left.
 * Expired rules, not-yet-started rules and exhausted rules are excluded here,
 * which is what makes them "stop on their own".
 */
export function liveDiscounts(asOf = today()) {
  return db
    .prepare(
      `SELECT * FROM discounts
        WHERE is_active = 1
          AND (start_date IS NULL OR start_date <= ?)
          AND (end_date   IS NULL OR end_date   >= ?)
          AND (max_uses = 0 OR used_count < max_uses)
        ORDER BY created_at ASC`
    )
    .all(asOf, asOf);
}

/**
 * Pick the single best discount for a set of lines. Rules never stack: the
 * customer silently gets the most generous one that qualifies.
 *
 * Returns { discount, amount, base, lineAmounts: Map<lineIndex, amount> } or null.
 */
export function bestDiscountFor({ lines, quantity, subtotal, asOf = today(), customerId = null }) {
  const rules = liveDiscounts(asOf);
  if (!rules.length) return null;

  let best = null;
  for (const rule of rules) {
    // Guard rails from the brief: minimum purchase value and minimum quantity.
    if (rule.min_purchase > 0 && subtotal < rule.min_purchase) continue;
    if (rule.min_quantity > 0 && quantity < rule.min_quantity) continue;

    let eligibleIdx = [];
    let base = 0;
    if (rule.applies_to === 'products') {
      const pids = new Set(discountProductIds(rule.id));
      if (!pids.size) continue;
      lines.forEach((l, i) => {
        if (l.product_id && pids.has(l.product_id)) {
          eligibleIdx.push(i);
          base += round2(l.quantity * l.unit_price);
        }
      });
      if (!eligibleIdx.length) continue;
    } else {
      eligibleIdx = lines.map((_, i) => i);
      base = subtotal;
    }
    if (base <= 0) continue;

    const raw = rule.kind === 'percent' ? (base * Number(rule.value)) / 100 : Number(rule.value);
    const amount = round2(Math.min(raw, base));
    if (amount <= 0) continue;

    if (!best || amount > best.amount) {
      // Spread the discount across the eligible lines proportionally so the
      // invoice shows exactly where the money came off.
      const lineAmounts = new Map();
      let allocated = 0;
      eligibleIdx.forEach((i, k) => {
        const lineBase = round2(lines[i].quantity * lines[i].unit_price);
        const share = k === eligibleIdx.length - 1
          ? round2(amount - allocated)
          : round2((amount * lineBase) / base);
        lineAmounts.set(i, share);
        allocated = round2(allocated + share);
      });
      best = { discount: rule, amount, base, lineAmounts };
    }
  }
  return best;
}

/** Record that a discount was consumed, so max_uses can actually run out. */
export function recordDiscountUsage(discount, { invoiceId, subscriptionId, customerId, amount, appliedOn }) {
  if (!discount) return;
  db.prepare(
    `INSERT INTO discount_usages (discount_id, invoice_id, subscription_id, customer_id, amount, applied_on)
     VALUES (?,?,?,?,?,?)`
  ).run(discount.id, invoiceId ?? null, subscriptionId ?? null, customerId ?? null, round2(amount), appliedOn);
  db.prepare('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?').run(discount.id);
}

/* ==================================================================== */
/* INVOICE BUILDER                                                      */
/* ==================================================================== */

/**
 * Build an invoice for one subscription period.
 *
 * Idempotent by design: the DB has a unique index on
 * (subscription_id, period_start, period_end) for non-cancelled invoices, so a
 * repeated run can never bill the same period twice. The caller gets
 * { skipped: true } instead of a duplicate.
 */
export function buildInvoiceForSubscription(sub, { periodStart, periodEnd, asOf, createdBy = null, send = false }) {
  const existing = db
    .prepare(
      `SELECT * FROM invoices
        WHERE subscription_id = ? AND period_start = ? AND period_end = ? AND state != 'cancelled'`
    )
    .get(sub.id, periodStart, periodEnd);
  if (existing) return { skipped: true, invoice: existing, reason: 'already-billed' };

  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(sub.plan_id);
  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(sub.customer_id);
  const subLines = db.prepare('SELECT * FROM subscription_lines WHERE subscription_id = ? ORDER BY id').all(sub.id);

  // ---- Assemble raw lines -------------------------------------------------
  const rawLines = [];
  const planProduct = plan ? db.prepare('SELECT * FROM products WHERE id = ?').get(plan.product_id) : null;

  if (plan) {
    rawLines.push({
      product_id: plan.product_id,
      variant_id: null,
      label: `${plan.name}${sub.quantity > 1 ? ` × ${sub.quantity}` : ''}`,
      quantity: sub.quantity,
      unit_price: sub.unit_price,
      product: planProduct,
      is_plan_line: 1,
    });
  }
  for (const l of subLines) {
    if (l.is_plan_line) continue;
    rawLines.push({
      product_id: l.product_id,
      variant_id: l.variant_id,
      label: l.label || 'Add-on',
      quantity: l.quantity,
      unit_price: l.unit_price,
      product: l.product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id) : null,
      is_plan_line: 0,
    });
  }
  if (!rawLines.length) return { skipped: true, reason: 'no-lines' };

  const subtotal = round2(rawLines.reduce((s, l) => s + l.quantity * l.unit_price, 0));

  // ---- Discount -----------------------------------------------------------
  const totalQty = rawLines.reduce((s, l) => s + l.quantity, 0);
  const applied = bestDiscountFor({
    lines: rawLines,
    quantity: totalQty,
    subtotal,
    asOf: periodStart,
    customerId: sub.customer_id,
  });

  // ---- Taxes + totals per line -------------------------------------------
  let discountTotal = 0;
  let taxTotal = 0;
  const computedLines = rawLines.map((l, i) => {
    const gross = round2(l.quantity * l.unit_price);
    const disc = applied?.lineAmounts.get(i) || 0;
    discountTotal = round2(discountTotal + disc);
    const net = round2(gross - disc);
    const taxRows = defaultTaxesForProduct(l.product);
    const taxRate = taxRateOf(taxRows);
    const taxAmount = round2((net * taxRate) / 100);
    taxTotal = round2(taxTotal + taxAmount);
    return {
      ...l,
      gross,
      discount_amount: disc,
      discount_label: disc > 0 ? applied.discount.name : null,
      net,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      tax_ids: taxRows.map((t) => t.id),
      tax_rows: taxRows,
      amount: round2(net + taxAmount),
    };
  });

  const total = round2(subtotal - discountTotal + taxTotal);

  // ---- Persist ------------------------------------------------------------
  const insert = db.transaction(() => {
    const number = db.nextNumber('invoice', getSetting('invoice_prefix', 'INV'));
    const invoiceDate = periodStart;
    const due = dueDateFor(invoiceDate, sub.payment_term || 'net30');
    const info = db
      .prepare(
        `INSERT INTO invoices
          (number, subscription_id, customer_id, state, invoice_date, due_date, period_start, period_end,
           subtotal, discount_total, tax_total, total, amount_paid, balance, notes, created_by)
         VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,0,?,?,?)`
      )
      .run(
        number, sub.id, sub.customer_id, invoiceDate, due, periodStart, periodEnd,
        subtotal, discountTotal, taxTotal, total, total,
        `Subscription ${sub.number} · ${periodStart} to ${periodEnd}`,
        createdBy
      );
    const invoiceId = info.lastInsertRowid;

    const insLine = db.prepare(
      `INSERT INTO invoice_lines
        (invoice_id, product_id, variant_id, description, quantity, unit_price, discount_amount,
         discount_label, tax_rate, tax_amount, amount, tax_ids)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const l of computedLines) {
      insLine.run(
        invoiceId, l.product_id, l.variant_id, l.label, l.quantity, l.unit_price,
        l.discount_amount, l.discount_label, l.tax_rate, l.tax_amount, l.amount,
        JSON.stringify(l.tax_ids)
      );
    }

    // Tax summary rows (one per tax, aggregated across lines)
    const taxSummary = new Map();
    for (const l of computedLines) {
      for (const t of l.tax_rows) {
        const key = t.id;
        const prev = taxSummary.get(key) || { tax_id: t.id, name: t.name, rate: t.rate, base: 0, amount: 0 };
        prev.base = round2(prev.base + l.net);
        prev.amount = round2(prev.amount + round2((l.net * Number(t.rate)) / 100));
        taxSummary.set(key, prev);
      }
    }
    const insTax = db.prepare(
      'INSERT INTO invoice_taxes (invoice_id, tax_id, name, rate, base, amount) VALUES (?,?,?,?,?,?)'
    );
    for (const t of taxSummary.values()) insTax.run(invoiceId, t.tax_id, t.name, t.rate, t.base, t.amount);

    if (applied) {
      recordDiscountUsage(applied.discount, {
        invoiceId, subscriptionId: sub.id, customerId: sub.customer_id,
        amount: discountTotal, appliedOn: periodStart,
      });
    }

    return { invoiceId, number, total };
  });

  const result = insert();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.invoiceId);

  if (send && customer) {
    queueMail({
      to: customer.email,
      subject: `Invoice ${invoice.number} from ${getSetting('company_name')}`,
      body:
        `Hi ${customer.name},\n\n` +
        `Your invoice ${invoice.number} for the period ${periodStart} to ${periodEnd} is ready.\n` +
        `Amount due: ${money(invoice.total)}\nDue date: ${invoice.due_date}\n\n` +
        `Thank you for subscribing to Brightloop.\n`,
      category: 'invoice',
      meta: { invoice_id: invoice.id },
    });
    db.prepare("UPDATE invoices SET sent_at = datetime('now') WHERE id = ?").run(invoice.id);
  }

  return { skipped: false, invoice, discount: applied?.discount || null };
}

/* ==================================================================== */
/* BILLING SWEEP                                                        */
/* ==================================================================== */

/**
 * Sweep every active subscription that is due on or before `asOf`.
 *
 *  - Catch-up: a daily plan that was missed for a week produces each period.
 *  - Idempotency: the unique period index stops double-billing.
 *  - Renewal / auto-close: when a subscription passes its expiry date it is
 *    either renewed (if the plan allows and the customer opted in) or closed.
 */
export function runBillingSweep({ asOf = today(), trigger = 'manual', user = null, limit = 5000 } = {}) {
  const startedAt = Date.now();
  const runInfo = db
    .prepare('INSERT INTO billing_runs (trigger_source, as_of_date, status) VALUES (?,?,?)')
    .run(trigger, asOf, 'running');
  const runId = runInfo.lastInsertRowid;

  let created = 0;
  let skipped = 0;
  let swept = 0;
  let totalAmount = 0;
  const detail = [];

  const due = db
    .prepare(
      `SELECT * FROM subscriptions
        WHERE state = 'active'
          AND next_billing_date IS NOT NULL
          AND next_billing_date <= ?
        ORDER BY next_billing_date ASC
        LIMIT ?`
    )
    .all(asOf, limit);

  swept = due.length;

  for (const sub of due) {
    try {
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(sub.plan_id);
      if (!plan) { skipped++; continue; }

      let guard = 0;
      let cursor = sub.next_billing_date;
      let expiry = sub.expiry_date;

      while (cursor && cursor <= asOf && guard < 400) {
        guard++;

        // Past expiry → renew or close, then decide whether to continue.
        if (dayjs(cursor).isAfter(dayjs(expiry), 'day')) {
          const canRenew =
            plan.allow_renew && sub.auto_renew &&
            (plan.max_renewals === 0 || sub.renewal_count < plan.max_renewals);
          if (canRenew) {
            expiry = dayjs(expiry).add(plan.interval_count, periodUnit(plan.billing_period)).format('YYYY-MM-DD');
            db.prepare(
              `UPDATE subscriptions SET expiry_date = ?, renewal_count = renewal_count + 1,
                 updated_at = datetime('now') WHERE id = ?`
            ).run(expiry, sub.id);
            sub.renewal_count += 1;
            detail.push({ subscription: sub.number, action: 'renewed', until: expiry });
          } else {
            closeSubscription(sub.id, plan.close_on_end ? 'auto-closed at end of term' : 'expired, not renewed');
            detail.push({ subscription: sub.number, action: 'closed', reason: 'end-of-term' });
            break;
          }
        }

        const periodStart = cursor;
        let periodEnd = dayjs(addCycle(cursor, plan.billing_period, plan.interval_count)).subtract(1, 'day').format('YYYY-MM-DD');
        if (dayjs(periodEnd).isAfter(dayjs(expiry), 'day')) periodEnd = expiry;

        const res = buildInvoiceForSubscription(sub, {
          periodStart, periodEnd, asOf, createdBy: user?.id ?? null, send: false,
        });

        if (res.skipped) {
          skipped++;
          detail.push({ subscription: sub.number, action: 'skipped', reason: res.reason, period: `${periodStart}→${periodEnd}` });
        } else {
          created++;
          totalAmount = round2(totalAmount + res.invoice.total);
        }

        cursor = addCycle(cursor, plan.billing_period, plan.interval_count);
        db.prepare(
          'UPDATE subscriptions SET next_billing_date = ?, last_billed_until = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(cursor, periodEnd, sub.id);
      }
    } catch (err) {
      skipped++;
      detail.push({ subscription: sub.number, action: 'error', reason: err.message });
    }
  }

  const duration = Date.now() - startedAt;
  db.prepare(
    `UPDATE billing_runs SET status = 'completed', subscriptions_swept = ?, invoices_created = ?,
       invoices_skipped = ?, total_amount = ?, duration_ms = ?, detail = ?, finished_at = datetime('now')
     WHERE id = ?`
  ).run(swept, created, skipped, totalAmount, duration, JSON.stringify(detail.slice(0, 500)), runId);

  logActivity(user, 'billing.run', 'billing_run', runId,
    `Billing sweep for ${asOf}: ${created} invoice(s) created, ${skipped} skipped, ${money(totalAmount)} billed`);

  return {
    runId, asOf, swept, created, skipped, totalAmount, durationMs: duration, detail,
  };
}

const periodUnit = (p) => ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[p] || 'month');

export function closeSubscription(id, reason = 'closed by user', user = null) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  if (!sub) return null;
  db.prepare(
    `UPDATE subscriptions SET state='closed', closed_at = datetime('now'), close_reason = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(reason, id);
  logActivity(user, 'subscription.close', 'subscription', id, `${sub.number} closed — ${reason}`);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}
