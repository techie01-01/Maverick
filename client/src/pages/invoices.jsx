import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, del } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Avatar, Badge, Card, ConfirmDialog, DetailRow, EmptyState, ErrorState, Field, Icon, Input,
  Loading, Modal, Pagination, SectionHeader, Select, Spinner, StateBadge, StatCard, Table, Tabs,
  Textarea, useToast,
} from '../components/ui.jsx';
import { date, dateTime, daysUntil, money, num, today, titleise } from '../lib/format.js';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'confirmed', label: 'Open' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' },
];

/* ==================================================================== */
/* LIST                                                                  */
/* ==================================================================== */
export function InvoicesPage() {
  const { settings, canManage } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState(params.get('q') || '');
  const [filter, setFilter] = useState(params.get('status') || params.get('state') || '');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    const query = { q, page, limit: 20 };
    if (['outstanding', 'overdue', 'paid'].includes(filter)) query.status = filter;
    else if (filter) query.state = filter;
    if (params.get('subscription_id')) query.subscription_id = params.get('subscription_id');
    get('/invoices', query).then(setData).catch(setError).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, page, params.get('subscription_id')]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  useEffect(() => {
    const next = {};
    if (q) next.q = q;
    if (filter) next[['outstanding', 'overdue', 'paid'].includes(filter) ? 'status' : 'state'] = filter;
    setParams(next, { replace: true });
  }, [q, filter, setParams]);

  const s = data?.summary || {};

  const batchConfirm = async () => {
    setBusy(true);
    try {
      const res = await post('/invoices/batch/confirm', { ids: selected });
      toast.success(`${res.confirmed} invoice(s) confirmed`, 'Billing');
      setSelected([]); setConfirmBatch(false); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Accounts receivable"
        title="Invoices"
        description="Every invoice raised from a subscription, with its tax breakdown, payment status and overdue days."
        actions={canManage ? (
          <>
            <button className="btn-secondary btn-sm" onClick={() => setManualOpen(true)}><Icon name="plus" className="w-3.5 h-3.5" /> One-off invoice</button>
            <Link to="/app/billing" className="btn-primary btn-sm"><Icon name="zap" className="w-3.5 h-3.5" /> Run billing</Link>
          </>
        ) : null}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Billed to date" value={money(s.billed, symbol)} icon="receipt" tone="brand" />
        <StatCard label="Open invoices" value={num(s.open_count)} sub={money(s.outstanding, symbol)} icon="clock" tone="amber" onClick={() => { setFilter('outstanding'); setPage(1); }} />
        <StatCard label="Overdue" value={money(s.overdue, symbol)} icon="alert" tone="red" onClick={() => { setFilter('overdue'); setPage(1); }} />
        <StatCard label="Paid" value={num(s.paid_count)} icon="checkCircle" tone="green" onClick={() => { setFilter('paid'); setPage(1); }} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-100">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search invoice or customer…" className="pl-9 h-9" />
          </div>
          <Tabs tabs={FILTERS.map((f) => ({
            ...f,
            count: f.id === 'draft' ? s.draft_count : f.id === 'confirmed' || f.id === 'outstanding' ? s.open_count : f.id === 'paid' ? s.paid_count : undefined,
          }))} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
          {selected.length > 0 && (
            <button className="btn-primary btn-sm ml-auto" onClick={() => setConfirmBatch(true)}>
              <Icon name="check" className="w-3.5 h-3.5" /> Confirm {selected.length}
            </button>
          )}
          {s.draft_count > 0 && selected.length === 0 && (
            <button className="btn-secondary btn-sm ml-auto" onClick={() => setConfirmBatch(true)}>
              <Icon name="checkCircle" className="w-3.5 h-3.5" /> Confirm all {s.draft_count} drafts
            </button>
          )}
        </div>

        {error ? <ErrorState error={error} onRetry={load} /> : loading && !data ? <Loading /> : (
          <>
            <Table
              columns={[
                {
                  key: 'check', label: '', width: 36,
                  render: (r) => r.state === 'draft' ? (
                    <input type="checkbox" checked={selected.includes(r.id)} className="w-4 h-4 rounded border-ink-300 text-brand-600"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
                  ) : <span className="block w-4" />,
                },
                {
                  key: 'number', label: 'Invoice',
                  render: (r) => (
                    <div>
                      <div className="font-mono text-[12.5px] font-semibold text-ink-900">{r.number}</div>
                      {r.subscription_number && <div className="text-[11px] text-ink-400 font-mono">{r.subscription_number}</div>}
                    </div>
                  ),
                },
                {
                  key: 'customer', label: 'Customer',
                  render: (r) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.company_name || r.customer_name} size="xs" />
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink-800 truncate max-w-[180px]">{r.company_name || r.customer_name}</div>
                        <div className="text-[11px] text-ink-400 truncate max-w-[180px]">{r.customer_email}</div>
                      </div>
                    </div>
                  ),
                },
                { key: 'invoice_date', label: 'Issued', render: (r) => <span className="text-[12.5px] text-ink-600">{date(r.invoice_date)}</span> },
                {
                  key: 'due_date', label: 'Due',
                  render: (r) => {
                    const overdue = r.state === 'confirmed' && r.balance > 0 && daysUntil(r.due_date) < 0;
                    return (
                      <div className="text-[12.5px]">
                        <div className={overdue ? 'text-rose-600 font-medium' : 'text-ink-600'}>{date(r.due_date)}</div>
                        {overdue && <div className="text-[10.5px] text-rose-500">{Math.abs(daysUntil(r.due_date))}d late</div>}
                      </div>
                    );
                  },
                },
                { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total, symbol)}</span> },
                {
                  key: 'balance', label: 'Balance', align: 'right',
                  render: (r) => <span className={`tabular ${r.balance > 0 ? 'font-medium text-amber-700' : 'text-ink-300'}`}>{r.balance > 0 ? money(r.balance, symbol) : '—'}</span>,
                },
                {
                  key: 'state', label: 'Status',
                  render: (r) => r.is_overdue ? <Badge tone="red">Overdue</Badge> : <StateBadge state={r.state} />,
                },
              ]}
              rows={data?.rows || []}
              onRowClick={(r) => navigate(`/app/invoices/${r.id}`)}
              empty={<EmptyState icon="receipt" title="No invoices match" description="Try a different filter, or run the billing sweep to generate this period's invoices." />}
            />
            <Pagination page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} limit={data?.limit || 20} onPage={setPage} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmBatch} onClose={() => setConfirmBatch(false)} onConfirm={batchConfirm} busy={busy}
        title="Confirm invoices?"
        message={selected.length
          ? `${selected.length} selected invoice(s) will move from Draft to Confirmed and become payable by the customer.`
          : `All ${s.draft_count} draft invoices will move to Confirmed and become payable.`}
        confirmLabel="Confirm invoices"
      />

      <ManualInvoiceModal open={manualOpen} onClose={() => setManualOpen(false)}
        onCreated={(row) => { toast.success(`Invoice ${row.number} drafted`); navigate(`/app/invoices/${row.id}`); }} />
    </div>
  );
}

/* ==================================================================== */
/* MANUAL (one-off) INVOICE                                              */
/* ==================================================================== */
function ManualInvoiceModal({ open, onClose, onCreated }) {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ customer_id: '', invoice_date: today(), payment_term: 'net30', notes: '' });
  const [lines, setLines] = useState([{ description: '', quantity: 1, unit_price: 0, tax_rate: 18 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    Promise.all([get('/users', { role: 'customer', limit: 200 }), get('/products', { limit: 100 }), get('/taxes')])
      .then(([c, p, t]) => {
        setCustomers(c.rows); setProducts(p.rows);
        const def = Number(t.rows.find((x) => x.is_active)?.rate ?? 18);
        setLines([{ description: '', quantity: 1, unit_price: 0, tax_rate: def }]);
      }).catch(() => {});
  }, [open]);

  const setLine = (i, k, v) => {
    const next = [...lines]; next[i] = { ...next[i], [k]: v };
    if (k === 'product_id') {
      const p = products.find((x) => String(x.id) === String(v));
      if (p) { next[i].description = p.name; next[i].unit_price = p.sales_price; }
    }
    setLines(next);
  };

  const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price) * (1 + Number(l.tax_rate || 0) / 100), 0);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await post('/invoices', {
        ...form, customer_id: Number(form.customer_id),
        lines: lines.filter((l) => l.description).map((l) => ({
          description: l.description, quantity: Number(l.quantity),
          unit_price: Number(l.unit_price), tax_rate: Number(l.tax_rate),
          product_id: l.product_id ? Number(l.product_id) : undefined,
        })),
      });
      onCreated?.(res.row); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="One-off invoice"
      description="For charges that do not come from a subscription."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.customer_id}>{busy && <Spinner className="w-4 h-4" />} Create draft</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Customer" required className="sm:col-span-1">
            <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.company_name || c.name}</option>)}
            </Select>
          </Field>
          <Field label="Invoice date"><Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
          <Field label="Payment terms">
            <Select value={form.payment_term} onChange={(e) => setForm({ ...form, payment_term: e.target.value })}>
              {['immediate', 'net7', 'net15', 'net30', 'net45', 'net60'].map((t) => <option key={t} value={t}>{t === 'immediate' ? 'Due on receipt' : titleise(t)}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Lines</label>
            <button className="btn-ghost btn-sm" onClick={() => setLines([...lines, { description: '', quantity: 1, unit_price: 0, tax_rate: 18 }])}>
              <Icon name="plus" className="w-3.5 h-3.5" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_70px_100px_70px_32px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400 px-1">
              <span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_100px_70px_32px] gap-2">
                <div>
                  <Input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Describe the charge" />
                  {products.length > 0 && (
                    <select value={l.product_id || ''} onChange={(e) => setLine(i, 'product_id', e.target.value)}
                      className="mt-1 w-full text-[11.5px] bg-transparent text-ink-400 outline-none cursor-pointer">
                      <option value="">Link a product (optional)…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
                <Input type="number" min="1" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                <Input type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} />
                <Input type="number" min="0" step="0.1" value={l.tax_rate} onChange={(e) => setLine(i, 'tax_rate', e.target.value)} />
                <button className="btn-ghost btn-sm text-rose-500" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                  <Icon name="trash" className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>

        <div className="rounded-lg bg-ink-50 border border-ink-200 px-4 py-3 flex items-center justify-between">
          <span className="text-[13px] text-ink-600">Total including tax</span>
          <span className="text-[15px] font-semibold text-ink-900 tabular">{money(total, symbol)}</span>
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* DETAIL + printable document                                           */
/* ==================================================================== */
export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, canManage } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(() => {
    get(`/invoices/${id}`).then((r) => setRow(r.row)).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (action, body) => {
    setBusy(action);
    try {
      const res = await post(`/invoices/${id}/${action}`, body || {});
      toast.success(res.message || `Invoice ${action}ed`);
      setCancelOpen(false);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const removeDraft = async () => {
    setBusy('delete');
    try {
      await del(`/invoices/${id}`);
      toast.success('Draft invoice deleted');
      navigate('/app/invoices');
    } catch (e) { toast.error(e.message); setBusy(''); }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!row) return <Loading />;

  const overdue = row.state === 'confirmed' && row.balance > 0 && daysUntil(row.due_date) < 0;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <button onClick={() => navigate(-1)} className="text-[12.5px] text-ink-500 hover:text-ink-900 flex items-center gap-1 mb-1">
            <Icon name="chevronLeft" className="w-3.5 h-3.5" /> Back
          </button>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[24px] font-semibold tracking-tight font-mono">{row.number}</h1>
            {overdue ? <Badge tone="red">Overdue {Math.abs(daysUntil(row.due_date))} days</Badge> : <StateBadge state={row.state} />}
            {row.subscription_id && (
              <Link to={`/app/subscriptions/${row.subscription_id}`} className="link text-[12.5px] font-mono">{row.subscription_number}</Link>
            )}
          </div>
          <p className="text-[13.5px] text-ink-500 mt-1">
            {row.company_name || row.customer_name} · issued {date(row.invoice_date)} · due {date(row.due_date)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" onClick={() => window.print()}><Icon name="print" className="w-3.5 h-3.5" /> Print / PDF</button>
          {canManage && row.state === 'draft' && (
            <>
              <button className="btn-primary btn-sm" onClick={() => act('confirm')} disabled={!!busy}>
                {busy === 'confirm' ? <Spinner className="w-3.5 h-3.5" /> : <Icon name="check" className="w-3.5 h-3.5" />} Confirm
              </button>
              <button className="btn-ghost btn-sm text-rose-600" onClick={removeDraft} disabled={!!busy}>Delete draft</button>
            </>
          )}
          {canManage && row.state !== 'draft' && row.state !== 'cancelled' && (
            <button className="btn-secondary btn-sm" onClick={() => act('send')} disabled={!!busy}>
              {busy === 'send' ? <Spinner className="w-3.5 h-3.5" /> : <Icon name="send" className="w-3.5 h-3.5" />} Send to customer
            </button>
          )}
          {canManage && row.balance > 0 && row.state !== 'draft' && row.state !== 'cancelled' && (
            <button className="btn-primary btn-sm" onClick={() => setPayOpen(true)}>
              <Icon name="wallet" className="w-3.5 h-3.5" /> Record payment
            </button>
          )}
          {canManage && row.state !== 'cancelled' && row.state !== 'paid' && (
            <button className="btn-ghost btn-sm text-rose-600" onClick={() => setCancelOpen(true)} disabled={!!busy}>Cancel invoice</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
        {/* ---------------- The invoice sheet ---------------- */}
        <div className="print-area card overflow-hidden">
          <div className="p-8 sm:p-10">
            {/* Header */}
            <div className="flex flex-wrap justify-between gap-6 pb-7 border-b border-ink-200">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round">
                      <path d="M6 18V6h6.5a3.5 3.5 0 0 1 0 7H6" />
                      <circle cx="17" cy="8" r="2" fill="#c7d2fe" stroke="none" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[16px] font-semibold text-ink-900 leading-none">{row.company.company_name}</div>
                    <div className="text-[11px] text-ink-500 mt-1">Subscription billing &amp; revenue</div>
                  </div>
                </div>
                <div className="mt-4 text-[12px] text-ink-500 leading-relaxed whitespace-pre-line">
                  {row.company.company_address}
                  {'\n'}{row.company.company_phone} · {row.company.company_email}
                  {row.company.company_tax_id ? `\nGSTIN: ${row.company.company_tax_id}` : ''}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">Tax invoice</div>
                <div className="text-[20px] font-semibold font-mono text-ink-900 mt-1">{row.number}</div>
                <div className="mt-3 space-y-1 text-[12px]">
                  <div className="flex justify-end gap-3"><span className="text-ink-400">Issued</span><span className="font-medium text-ink-800">{date(row.invoice_date)}</span></div>
                  <div className="flex justify-end gap-3"><span className="text-ink-400">Due</span><span className={`font-medium ${overdue ? 'text-rose-600' : 'text-ink-800'}`}>{date(row.due_date)}</span></div>
                  {row.period_start && (
                    <div className="flex justify-end gap-3"><span className="text-ink-400">Period</span><span className="font-medium text-ink-800">{date(row.period_start)} – {date(row.period_end)}</span></div>
                  )}
                </div>
              </div>
            </div>

            {/* Parties */}
            <div className="grid sm:grid-cols-2 gap-6 py-6 border-b border-ink-200">
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">Billed to</div>
                <div className="text-[14px] font-semibold text-ink-900">{row.company_name || row.customer_name}</div>
                <div className="text-[12px] text-ink-600 mt-1 leading-relaxed">
                  {row.customer_name}<br />
                  {row.customer_address && <>{row.customer_address}<br /></>}
                  {[row.customer_city, row.customer_country].filter(Boolean).join(', ')}
                  {row.customer_email && <><br />{row.customer_email}</>}
                  {row.customer_phone && <><br />{row.customer_phone}</>}
                  {row.customer_tax_id && <><br />GSTIN: {row.customer_tax_id}</>}
                </div>
              </div>
              <div className="sm:text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">Payment terms</div>
                <div className="text-[13px] font-medium text-ink-800">{row.terms_label || (row.due_date === row.invoice_date ? 'Due on receipt' : titleise(row.payment_term || 'net30'))}</div>
                {row.subscription_number && (
                  <>
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 mt-4">Subscription</div>
                    <div className="text-[13px] font-mono font-medium text-ink-800">{row.subscription_number}</div>
                  </>
                )}
              </div>
            </div>

            {/* Lines */}
            <table className="w-full mt-6">
              <thead>
                <tr className="border-b border-ink-200">
                  <th className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 pb-2">Description</th>
                  <th className="text-right text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 pb-2 w-14">Qty</th>
                  <th className="text-right text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 pb-2 w-24">Rate</th>
                  <th className="text-right text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 pb-2 w-20">Tax</th>
                  <th className="text-right text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 pb-2 w-28">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {row.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 pr-3">
                      <div className="text-[13px] text-ink-900">{l.description}</div>
                      {l.discount_amount > 0 && (
                        <div className="text-[11px] text-emerald-600 mt-0.5">
                          − {money(l.discount_amount, symbol)} · {l.discount_label}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-[13px] text-ink-600 tabular">{l.quantity}</td>
                    <td className="py-2.5 text-right text-[13px] text-ink-600 tabular">{money(l.unit_price, symbol)}</td>
                    <td className="py-2.5 text-right text-[13px] text-ink-500 tabular">{l.tax_rate}%</td>
                    <td className="py-2.5 text-right text-[13px] font-medium text-ink-900 tabular">{money(l.amount, symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex flex-col sm:flex-row justify-between gap-6 mt-6 pt-5 border-t border-ink-200">
              <div className="max-w-xs">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 mb-1">Amount in words</div>
                <div className="text-[12px] text-ink-600 italic leading-relaxed">{row.amount_in_words}</div>
                {row.notes && <p className="text-[11.5px] text-ink-500 mt-3 leading-relaxed">{row.notes}</p>}
              </div>
              <div className="w-full sm:w-[268px] space-y-1.5">
                <Row2 label="Subtotal" value={money(row.subtotal, symbol)} />
                {row.discount_total > 0 && <Row2 label="Discount" value={`− ${money(row.discount_total, symbol)}`} tone="green" />}
                {row.taxes.map((t) => <Row2 key={t.id} label={`${t.name}`} value={money(t.amount, symbol)} muted />)}
                <div className="border-t border-ink-200 pt-2 mt-2 flex justify-between items-baseline">
                  <span className="text-[13px] font-semibold text-ink-900">Total</span>
                  <span className="text-[17px] font-semibold text-ink-900 tabular">{money(row.total, symbol)}</span>
                </div>
                {row.amount_paid > 0 && <Row2 label="Amount paid" value={`− ${money(row.amount_paid, symbol)}`} tone="green" />}
                <div className={`flex justify-between items-baseline rounded-lg px-3 py-2 ${row.balance > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                  <span className="text-[12.5px] font-semibold text-ink-900">{row.balance > 0 ? 'Balance due' : 'Settled'}</span>
                  <span className={`text-[15px] font-semibold tabular ${row.balance > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>{money(row.balance, symbol)}</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-ink-100 text-[10.5px] text-ink-400 flex flex-wrap justify-between gap-2">
              <span>Computer-generated invoice — no signature required.</span>
              <span>Payment reference: {row.number}</span>
            </div>
          </div>
        </div>

        {/* ---------------- Side rail ---------------- */}
        <div className="space-y-4 no-print">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-ink-900">Payment status</h3>
              {row.state === 'paid' ? <Badge tone="green"><Icon name="check" className="w-3 h-3" /> Paid</Badge> : <Badge tone={overdue ? 'red' : 'amber'}>{overdue ? 'Overdue' : 'Open'}</Badge>}
            </div>

            <div className="rounded-lg bg-ink-50 p-3 mb-4">
              <div className="flex justify-between text-[12px] text-ink-500 mb-1.5">
                <span>Collected</span><span className="tabular">{money(row.amount_paid, symbol)}</span>
              </div>
              <div className="h-2 rounded-full bg-ink-200 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min((row.amount_paid / Math.max(row.total, 1)) * 100, 100)}%` }} />
              </div>
              <div className="flex justify-between text-[12px] text-ink-500 mt-1.5">
                <span>Outstanding</span><span className="tabular">{money(row.balance, symbol)}</span>
              </div>
            </div>

            <dl>
              <DetailRow label="Issued">{date(row.invoice_date)}</DetailRow>
              <DetailRow label="Due">{date(row.due_date)}</DetailRow>
              <DetailRow label="Sent">{row.sent_at ? dateTime(row.sent_at) : 'Not sent'}</DetailRow>
              <DetailRow label="Confirmed">{row.confirmed_at ? dateTime(row.confirmed_at) : '—'}</DetailRow>
              <DetailRow label="Tax total">{money(row.tax_total, symbol)}</DetailRow>
              <DetailRow label="Discount">{money(row.discount_total, symbol)}</DetailRow>
            </dl>

            {row.balance > 0 && row.state !== 'draft' && row.state !== 'cancelled' && canManage && (
              <button className="btn-primary w-full mt-4" onClick={() => setPayOpen(true)}>
                <Icon name="wallet" className="w-4 h-4" /> Record payment
              </button>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-ink-900 mb-3">Payments received</h3>
            {row.payments.length === 0 ? (
              <p className="text-[12.5px] text-ink-400">Nothing recorded yet. Payments you record appear here and settle the invoice automatically.</p>
            ) : (
              <div className="space-y-2.5">
                {row.payments.map((p) => (
                  <div key={p.id} className="flex items-start gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <Icon name="check" className="w-3.5 h-3.5" strokeWidth={2.6} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-[12.5px] font-medium text-ink-900">{money(p.amount, symbol)}</span>
                        <span className="text-[11px] text-ink-400">{date(p.payment_date)}</span>
                      </div>
                      <div className="text-[11px] text-ink-500">{titleise(p.method)}{p.reference ? ` · ${p.reference}` : ''}</div>
                      {p.note && <div className="text-[11px] text-ink-400 italic mt-0.5">{p.note}</div>}
                      <div className="font-mono text-[10px] text-ink-300 mt-0.5">{p.number}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)} invoice={row} onSaved={load} />
      <ConfirmDialog
        open={cancelOpen} onClose={() => setCancelOpen(false)} busy={busy === 'cancel'}
        onConfirm={() => act('cancel', { reason: 'Cancelled by the billing team' })}
        title="Cancel this invoice?"
        message="The invoice will be voided and its billing period released so it can be re-issued. This cannot be undone."
        confirmLabel="Cancel invoice" tone="danger"
      />
    </div>
  );
}

const Row2 = ({ label, value, tone, muted }) => (
  <div className="flex justify-between text-[12.5px]">
    <span className={muted ? 'text-ink-400' : 'text-ink-500'}>{label}</span>
    <span className={`tabular ${tone === 'green' ? 'text-emerald-600' : muted ? 'text-ink-500' : 'text-ink-700'}`}>{value}</span>
  </div>
);

/* ==================================================================== */
/* RECORD PAYMENT                                                        */
/* ==================================================================== */
export function RecordPaymentModal({ open, onClose, invoice, onSaved }) {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState({ amount: '', method: 'bank_transfer', payment_date: today(), note: '', reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({ amount: invoice?.balance ?? '', method: 'bank_transfer', payment_date: today(), note: '', reference: '' });
    setError('');
    get('/payments/methods').then((r) => setMethods(r.rows)).catch(() => {});
  }, [open, invoice]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await post('/payments', {
        invoice_id: invoice.id, amount: Number(form.amount), method: form.method,
        payment_date: form.payment_date, note: form.note, reference: form.reference,
      });
      toast.success(
        `${money(res.row.amount, symbol)} recorded`,
        res.fully_paid ? 'Invoice fully settled' : `Balance now ${money(res.invoice.balance, symbol)}`
      );
      onSaved?.(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a payment"
      description={invoice ? `Against ${invoice.number} · balance ${money(invoice.balance, symbol)}` : ''}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.amount}>{busy && <Spinner className="w-4 h-4" />} Record payment</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" required hint={invoice ? `Outstanding ${money(invoice.balance, symbol)}` : ''}>
            <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
          </Field>
          <Field label="Payment method">
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Payment date"><Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></Field>
          <Field label="Reference / UTR"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. HDFC-88213" /></Field>
        </div>
        <Field label="Note"><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything worth remembering about this payment…" /></Field>
        <div className="flex gap-2">
          {[25, 50, 100].map((p) => (
            <button key={p} className="btn-secondary btn-sm" onClick={() => setForm({ ...form, amount: (invoice.balance * p / 100).toFixed(2) })}>
              {p === 100 ? 'Full balance' : `${p}%`}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
