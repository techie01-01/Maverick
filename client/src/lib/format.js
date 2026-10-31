/* Small formatting helpers shared by every screen. */

export const money = (n, symbol = '₹') => {
  const v = Number(n) || 0;
  return symbol + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Compact money for KPI tiles: ₹1.79M / ₹24.5K */
export const moneyShort = (n, symbol = '₹') => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${symbol}${(v / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${symbol}${(v / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${symbol}${(v / 1e3).toFixed(1)}K`;
  return `${symbol}${v.toFixed(0)}`;
};

export const num = (n) => (Number(n) || 0).toLocaleString('en-IN');

export const date = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const dateShort = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export const dateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).includes('T') ? d : `${String(d).replace(' ', 'T')}Z`);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const today = () => new Date().toISOString().slice(0, 10);

export const daysUntil = (d) => {
  if (!d) return null;
  const a = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  const b = new Date(`${today()}T00:00:00`);
  return Math.round((a - b) / 86400000);
};

export const relative = (d) => {
  const n = daysUntil(d);
  if (n === null) return '—';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
};

export const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

export const titleise = (s = '') =>
  String(s).replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);

export const cadence = (period, count = 1) => {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[period] || 'month';
  return count > 1 ? `Every ${count} ${unit}s` : `Every ${unit}`;
};

export const planCycle = (period) => ({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[period] || 'Monthly');

/* Colour vocabulary, kept in one place so states look consistent everywhere. */
export const STATE_STYLES = {
  draft: 'bg-ink-100 text-ink-600 ring-ink-200',
  quotation: 'bg-amber-50 text-amber-700 ring-amber-200',
  confirmed: 'bg-sky-50 text-sky-700 ring-sky-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  paused: 'bg-violet-50 text-violet-700 ring-violet-200',
  closed: 'bg-ink-100 text-ink-500 ring-ink-200',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-200',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200',
  sent: 'bg-sky-50 text-sky-700 ring-sky-200',
  live: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  expired: 'bg-ink-100 text-ink-500 ring-ink-200',
  exhausted: 'bg-amber-50 text-amber-700 ring-amber-200',
  scheduled: 'bg-sky-50 text-sky-700 ring-sky-200',
  inactive: 'bg-ink-100 text-ink-500 ring-ink-200',
};
