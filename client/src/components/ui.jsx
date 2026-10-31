import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATE_STYLES, titleise } from '../lib/format.js';

/* ================================================================== */
/* Icons — inline SVG so nothing depends on a CDN                      */
/* ================================================================== */
const ICONS = {
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  box: 'M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7ZM12 12 3 8.5M12 12l9-3.5M12 12v9',
  layers: 'M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Zm3 5h8M8 12h8M8 15h5',
  card: 'M2 7h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Zm0 4h20M6 15h3',
  tag: 'M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8ZM7 7h.01',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2M18 3v5h-5M6 21v-5h5',
  chart: 'M3 3v18h18M7 15l3-4 3 3 5-6',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4Z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 3-10 6L2 7',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'm20 6-11 11-5-5',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  chevronLeft: 'm15 18-6-6 6-6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  trash: 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5M14 11v5',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8Z',
  play: 'm5 3 14 9-14 9V3Z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14h.01M11 12h1v6h1',
  sparkles: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3Z',
  building: 'M3 21h18M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  lock: 'M5 11h14v10H5V11Zm3 0V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 5.1-5.9m3-1a9.7 9.7 0 0 1 1.9-.1c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  checkCircle: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4l-10 10-3-3',
  xCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-7 6-6M9 9l6 6',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4h-4Z',
  trending: 'm23 6-9.5 9.5-5-5L1 18M17 6h6v6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6',
  percent: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
};

export function Icon({ name, className = 'w-4 h-4', strokeWidth = 1.8 }) {
  const path = ICONS[name];
  if (!path) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/* ================================================================== */
/* Layout primitives                                                   */
/* ================================================================== */
export function Card({ className = '', children, ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

export function SectionHeader({ eyebrow, title, description, actions, className = '' }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div>
        {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600 mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="text-sm text-ink-500 mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'ink', className = '' }) {
  const map = {
    ink: 'bg-ink-100 text-ink-600 ring-ink-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return <span className={`chip ${map[tone] || map.ink} ${className}`}>{children}</span>;
}

export function StateBadge({ state, className = '' }) {
  const style = STATE_STYLES[state] || STATE_STYLES.draft;
  return (
    <span className={`chip ${style} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {titleise(state)}
    </span>
  );
}

export function Avatar({ name = '', size = 'md', className = '' }) {
  const sizes = { xs: 'w-6 h-6 text-[10px]', sm: 'w-8 h-8 text-[11px]', md: 'w-9 h-9 text-xs', lg: 'w-12 h-12 text-sm' };
  const chars = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-semibold text-white shrink-0 ring-2 ring-white ${className}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 38) % 360} 66% 44%))` }}
      title={name}
    >
      {chars}
    </div>
  );
}

/* ================================================================== */
/* Form controls                                                       */
/* ================================================================== */
export function Field({ label, hint, error, required, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-rose-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ error, className = '', ...rest }) {
  return <input className={`field ${error ? 'field-error' : ''} ${className}`} {...rest} />;
}

export function Textarea({ error, className = '', rows = 3, ...rest }) {
  return <textarea rows={rows} className={`field ${error ? 'field-error' : ''} ${className}`} {...rest} />;
}

export function Select({ error, className = '', children, ...rest }) {
  return (
    <div className="relative">
      <select className={`field appearance-none pr-9 ${error ? 'field-error' : ''} ${className}`} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-ink-200'}`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className="leading-snug">
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description && <span className="block text-[12px] text-ink-500 mt-0.5">{description}</span>}
      </span>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className = '' }) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${className}`}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30" />
      <span className="text-sm text-ink-700">{label}</span>
    </label>
  );
}

/* ================================================================== */
/* Modal / Drawer                                                      */
/* ================================================================== */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-ink-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={`relative w-full ${sizes[size]} bg-white rounded-2xl shadow-pop animate-scale-in my-auto`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-ink-100">
          <div>
            <h3 className="text-base font-semibold text-ink-900">{title}</h3>
            {description && <p className="text-[13px] text-ink-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Close">
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-ink-100 bg-ink-50/60 rounded-b-2xl flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ================================================================== */
/* Toasts                                                              */
/* ================================================================== */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, tone: 'success', ...toast }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), toast.duration || 4200);
  }, []);

  const value = useMemo(() => ({
    toast: push,
    success: (message, title) => push({ tone: 'success', message, title }),
    error: (message, title) => push({ tone: 'error', message, title }),
    info: (message, title) => push({ tone: 'info', message, title }),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2.5rem)] no-print">
        {toasts.map((t) => (
          <div key={t.id}
            className={`animate-slide-in rounded-xl shadow-pop border px-4 py-3 flex items-start gap-3 bg-white
              ${t.tone === 'error' ? 'border-rose-200' : t.tone === 'info' ? 'border-sky-200' : 'border-emerald-200'}`}>
            <div className={`mt-0.5 ${t.tone === 'error' ? 'text-rose-500' : t.tone === 'info' ? 'text-sky-500' : 'text-emerald-500'}`}>
              <Icon name={t.tone === 'error' ? 'xCircle' : t.tone === 'info' ? 'info' : 'checkCircle'} className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              {t.title && <div className="text-[13px] font-semibold text-ink-900">{t.title}</div>}
              <div className="text-[13px] text-ink-600 leading-snug break-words">{t.message}</div>
            </div>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-ink-300 hover:text-ink-500">
              <Icon name="close" className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ================================================================== */
/* Data states                                                         */
/* ================================================================== */
export function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2.5 py-16 text-ink-400 text-sm ${className}`}>
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ rows = 5 }) {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-ink-100 animate-pulse" style={{ width: `${92 - i * 6}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'box', title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      <div className="w-12 h-12 rounded-xl bg-ink-100 text-ink-400 flex items-center justify-center mb-3">
        <Icon name={icon} className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description && <p className="text-[13px] text-ink-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center mb-3">
        <Icon name="alert" className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-semibold text-ink-800">Something went wrong</h3>
      <p className="text-[13px] text-ink-500 mt-1 max-w-sm">{error?.message || 'Unable to load this data.'}</p>
      {onRetry && <button className="btn-secondary btn-sm mt-4" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/* ================================================================== */
/* Table                                                               */
/* ================================================================== */
export function Table({ columns, rows, rowKey = (r, i) => r.id ?? i, onRowClick, empty, footer, dense }) {
  if (!rows?.length) return empty || <EmptyState title="Nothing here yet" description="Records will appear here once they exist." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink-100 bg-ink-50/60">
            {columns.map((c) => (
              <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''} ${c.className || ''}`} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              onClick={onRowClick ? () => onRowClick(r, i) : undefined}
              className={`row-hover ${onRowClick ? 'cursor-pointer' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`td ${dense ? 'py-2' : ''} ${c.align === 'right' ? 'text-right tabular' : ''} ${c.className || ''}`}>
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t border-ink-200 bg-ink-50/60">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Pagination({ page, pages, total, limit, onPage, className = '' }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-ink-100 ${className}`}>
      <p className="text-[13px] text-ink-500">
        Showing <span className="font-medium text-ink-800">{from}</span>–<span className="font-medium text-ink-800">{to}</span> of{' '}
        <span className="font-medium text-ink-800">{total.toLocaleString('en-IN')}</span>
      </p>
      <div className="flex items-center gap-1">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <Icon name="chevronLeft" className="w-4 h-4" /> Prev
        </button>
        <span className="px-2 text-[13px] text-ink-500 tabular">{page} / {pages}</span>
        <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <Icon name="chevronRight" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* KPI card                                                            */
/* ================================================================== */
export function StatCard({ label, value, sub, icon, trend, tone = 'brand', onClick, className = '' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
    sky: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
    ink: 'bg-ink-100 text-ink-600',
  };
  return (
    <div
      onClick={onClick}
      className={`card p-5 transition-all ${onClick ? 'cursor-pointer hover:shadow-lift hover:-translate-y-0.5' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium text-ink-500">{label}</p>
        {icon && <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tones[tone] || tones.brand}`}><Icon name={icon} className="w-4 h-4" /></div>}
      </div>
      <div className="mt-2 flex items-baseline gap-2 flex-wrap">
        <span className="kpi-value">{value}</span>
        {trend !== undefined && trend !== null && (
          <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            <Icon name={trend >= 0 ? 'arrowUp' : 'arrowDown'} className="w-3 h-3" />
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {sub && <p className="mt-1 text-[12px] text-ink-400">{sub}</p>}
    </div>
  );
}

/* ================================================================== */
/* Confirm dialog                                                      */
/* ================================================================== */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={tone === 'danger' ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner className="w-4 h-4" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-600 leading-relaxed">{message}</p>
    </Modal>
  );
}

/* ================================================================== */
/* Tabs                                                                */
/* ================================================================== */
export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`flex gap-1 overflow-x-auto ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors
            ${value === t.id ? 'bg-ink-900 text-white shadow-sm' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800'}`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`ml-1.5 text-[11px] tabular ${value === t.id ? 'text-white/60' : 'text-ink-400'}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* Simple built-in dropdown menu. */
export function Menu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={`absolute z-30 mt-1.5 min-w-[190px] rounded-xl border border-ink-200 bg-white p-1.5 shadow-pop animate-scale-in
            ${align === 'right' ? 'right-0' : 'left-0'}`}
          key={id}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={`d${i}`} className="my-1 h-px bg-ink-100" />
            ) : (
              <button
                key={it.label}
                onClick={() => { setOpen(false); it.onClick?.(); }}
                disabled={it.disabled}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-left transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-700 hover:bg-ink-100'}`}
              >
                {it.icon && <Icon name={it.icon} className="w-3.5 h-3.5" />}
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* Definition-list row used across detail pages. */
export function DetailRow({ label, children, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-2.5 border-b border-ink-100 last:border-0 ${className}`}>
      <dt className="text-[13px] text-ink-500 shrink-0">{label}</dt>
      <dd className="text-[13px] font-medium text-ink-900 text-right">{children ?? '—'}</dd>
    </div>
  );
}
