import dayjs from 'dayjs';
import { db, getSetting } from '../db.js';

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const today = () => dayjs().format('YYYY-MM-DD');
export const fmt = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : null);

/** True if `date` is today or earlier. */
export const isDue = (date, asOf = today()) => !!date && dayjs(date).isBefore(dayjs(asOf).add(1, 'day'), 'day');

/** Advance a date by one billing cycle. Clamps to end-of-month (Jan 31 -> Feb 28). */
export function addCycle(dateStr, period, count = 1) {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[period] || 'month';
  return dayjs(dateStr).add(count, unit).format('YYYY-MM-DD');
}

/** Human label for a plan's cadence. */
export function cadenceLabel(period, count = 1) {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[period] || 'month';
  if (count === 1) return `Every ${unit}`;
  return `Every ${count} ${unit}s`;
}

export function paymentTermDays(term) {
  return { immediate: 0, net7: 7, net15: 15, net30: 30, net45: 45, net60: 60 }[term] ?? 30;
}

export function dueDateFor(invoiceDate, term) {
  return dayjs(invoiceDate).add(paymentTermDays(term), 'day').format('YYYY-MM-DD');
}

/** 12-month MRR contribution of one subscription line. */
export function monthlyValue(period, count, amount) {
  const n = Math.max(count || 1, 1);
  const a = Number(amount) || 0;
  switch (period) {
    case 'daily': return (a * 365) / 12 / n;
    case 'weekly': return (a * 52) / 12 / n;
    case 'yearly': return a / 12 / n;
    case 'monthly':
    default: return a / n;
  }
}

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */
export function logActivity(user, action, entity, entityId, summary) {
  try {
    db.prepare(
      `INSERT INTO activity_log (user_id, actor, action, entity, entity_id, summary)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(user?.id ?? null, user?.name ?? user?.email ?? 'system', action, entity ?? null, entityId ?? null, summary ?? null);
  } catch { /* logging must never break a request */ }
}

/* ------------------------------------------------------------------ */
/* Email outbox — the demo "SMTP". Swap sendMail() for nodemailer in prod. */
/* ------------------------------------------------------------------ */
export function queueMail({ to, subject, body, category = 'general', meta = null }) {
  const info = db
    .prepare(`INSERT INTO mail_outbox (to_email, subject, body, category, status, meta) VALUES (?,?,?,?,'queued',?)`)
    .run(to, subject, body, category, meta ? JSON.stringify(meta) : null);
  return info.lastInsertRowid;
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (msg, details) => new ApiError(400, msg, details);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const forbidden = (msg = 'You do not have access to this action') => new ApiError(403, msg);

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw bad(`Missing required field(s): ${missing.join(', ')}`, { missing });
}

export function parsePaging(query, defaultLimit = 25) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 200);
  return { page, limit, offset: (page - 1) * limit };
}

export function paged(rows, total, page, limit) {
  return {
    rows,
    total,
    page,
    limit,
    pages: Math.max(Math.ceil(total / limit), 1),
  };
}

export const settingsSnapshot = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

export const money = (n) => `${getSetting('currency_symbol', '₹')}${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
