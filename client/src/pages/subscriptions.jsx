import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Avatar, Badge, Card, ConfirmDialog, DetailRow, EmptyState, ErrorState, Field, Icon, Input,
  Loading, Modal, Pagination, SectionHeader, Select, Spinner, StatCard, StateBadge, Table, Tabs,
  Textarea, useToast,
} from '../components/ui.jsx';
import { cadence, date, daysUntil, money, num, relative, titleise } from '../lib/format.js';

const STATE_TABS = [
  { id: '', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'quotation', label: 'Quotations' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'paused', label: 'Paused' },
  { id: 'draft', label: 'Drafts' },
  { id: 'closed', label: 'Closed' },
];

/* ==================================================================== */
/* LIST                                                                  */
/* ==================================================================== */
export function SubscriptionsPage() {
  const { settings, canManage } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState(params.get('q') || '');
  const [stateFilter, setStateFilter] = useState(params.get('state') || '');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1');

  const load = useCallback(() => {
    setLoading(true); setError(null);
    get('/subscriptions', { q, state: stateFilter, page, limit: 20 })
      .then(setData).catch(setError).finally(() => setLoading(false));
  }, [q, stateFilter, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const next = {};
    if (q) next.q = q;
    if (stateFilter) next.state = stateFilter;
    setParams(next, { replace: true });
  }, [q, stateFilter, setParams]);

  const summary = data?.summary || {};

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Recurring revenue"
        title="Subscriptions"
        description="Every contract in the book, from the first quotation to the day it closes. Open one to pause, renew, bill or close it."
        actions={canManage ? (
          <>
            <Link to="/app/billing" className="btn-secondary btn-sm"><Icon name="zap" className="w-3.5 h-3.5" /> Billing</Link>
            <button className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" className="w-3.5 h-3.5" /> New subscription
            </button>
          </>
        ) : null}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active" value={num(summary.active || 0)} icon="checkCircle" tone="green" onClick={() => { setStateFilter('active'); setPage(1); }} />
        <StatCard label="In negotiation" value={num((summary.quotation || 0) + (summary.confirmed || 0))} icon="file" tone="amber" onClick={() => { setStateFilter('quotation'); setPage(1); }} />
        <StatCard label="Paused" value={num(summary.paused || 0)} icon="pause" tone="violet" onClick={() => { setStateFilter('paused'); setPage(1); }} />
        <StatCard label="Closed" value={num(summary.closed || 0)} icon="xCircle" tone="ink" onClick={() => { setStateFilter('closed'); setPage(1); }} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-100">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search number, customer or plan…" className="pl-9 h-9" />
          </div>
          <Tabs tabs={STATE_TABS.map((t) => ({ ...t, count: t.id ? summary[t.id] : undefined }))}
            value={stateFilter} onChange={(v) => { setStateFilter(v); setPage(1); }} />
        </div>

        {error ? <ErrorState error={error} onRetry={load} /> : loading && !data ? <Loading /> : (
          <>
            <Table
              columns={[
                {
                  key: 'number', label: 'Subscription',
                  render: (r) => (
                    <div>
                      <div className="font-mono text-[12.5px] font-semibold text-ink-900">{r.number}</div>
                      <div className="text-[11.5px] text-ink-500 mt-0.5">{r.plan_name}</div>
                    </div>
                  ),
                },
                {
                  key: 'customer', label: 'Customer',
                  render: (r) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.company_name || r.customer_name} size="sm" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink-900 truncate max-w-[190px]">{r.company_name || r.customer_name}</div>
                        <div className="text-[11px] text-ink-400 truncate max-w-[190px]">{r.customer_email}</div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'term', label: 'Term',
                  render: (r) => (
                    <div className="text-[12px]">
                      <div className="text-ink-700">{date(r.start_date)}</div>
                      <div className="text-ink-400">to {date(r.expiry_date)}</div>
                    </div>
                  ),
                },
                {
                  key: 'cycle', label: 'Billing',
                  render: (r) => (
                    <div className="text-[12px]">
                      <div className="text-ink-700 capitalize">{cadence(r.billing_period, r.interval_count)}</div>
                      <div className="text-ink-400 tabular">{r.quantity} × {money(r.unit_price, symbol)}</div>
                    </div>
                  ),
                },
                {
                  key: 'next', label: 'Next bill',
                  render: (r) => {
                    if (r.state !== 'active' || !r.next_billing_date) return <span className="text-ink-300">—</span>;
                    const d = daysUntil(r.next_billing_date);
                    return (
                      <div className="text-[12px]">
                        <div className="text-ink-700">{date(r.next_billing_date)}</div>
                        <div className={d < 0 ? 'text-rose-600 font-medium' : d <= 3 ? 'text-amber-600 font-medium' : 'text-ink-400'}>
                          {relative(r.next_billing_date)}
                        </div>
                      </div>
                    );
                  },
                },
                { key: 'mrr', label: 'MRR', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.mrr, symbol)}</span> },
                {
                  key: 'state', label: 'Status',
                  render: (r) => (
                    <div className="flex flex-col items-start gap-1">
                      <StateBadge state={r.state} />
                      {r.outstanding > 0 && <span className="text-[10.5px] text-rose-600 font-medium">{money(r.outstanding, symbol)} due</span>}
                    </div>
                  ),
                },
              ]}
              rows={data?.rows || []}
              onRowClick={(r) => navigate(`/app/subscriptions/${r.id}`)}
              empty={<EmptyState icon="refresh" title="No subscriptions match" description="Adjust the filters, or create the first subscription for a customer." />}
            />
            <Pagination page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} limit={data?.limit || 20} onPage={setPage} />
          </>
        )}
      </Card>

      <CreateSubscriptionModal open={createOpen} onClose={() => setCreateOpen(false)}
        onCreated={(row) => { toast.success(`${row.number} created`, 'Subscription'); navigate(`/app/subscriptions/${row.id}`); }} />
    </div>
  );
}

/* ==================================================================== */
/* CREATE MODAL                                                          */
/* ==================================================================== */
export function CreateSubscriptionModal({ open, onClose, onCreated, presetCustomer }) {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    customer_id: presetCustomer || '', plan_id: '', start_date: new Date().toISOString().slice(0, 10),
    duration_cycles: 1, quantity: 1, payment_term: 'net30', notes: '', template_id: '', state: 'draft',
  });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    Promise.all([
      get('/users', { role: 'customer', limit: 200 }),
      get('/plans', { active: 'true' }),
      get('/quotation-templates'),
      get('/products', { limit: 100, active: 'true' }),
    ]).then(([c, p, t, pr]) => {
      setCustomers(c.rows);
      setPlans(p.rows.filter((x) => x.is_active));
      setTemplates(t.rows);
      setProducts(pr.rows);
    }).catch((e) => setError(e.message));
  }, [open]);

  const plan = useMemo(() => plans.find((p) => String(p.id) === String(form.plan_id)), [plans, form.plan_id]);

  useEffect(() => {
    if (plan && form.quantity < plan.min_quantity) {
      setForm((f) => ({ ...f, quantity: plan.min_quantity }));
    }
  }, [plan]);

  const applyTemplate = (tplId) => {
    const tpl = templates.find((t) => String(t.id) === String(tplId));
    if (!tpl) { setForm((f) => ({ ...f, template_id: '' })); return; }
    setForm((f) => ({
      ...f, template_id: tplId, plan_id: tpl.plan_id || f.plan_id,
      quantity: tpl.quantity, payment_term: tpl.payment_term, notes: tpl.notes || f.notes,
    }));
    setLines(tpl.lines.map((l) => ({
      product_id: l.product_id, label: l.label || l.product_name, quantity: l.quantity, unit_price: l.unit_price,
    })));
  };

  const addLine = () => {
    const p = products[0];
    if (!p) return;
    setLines([...lines, { product_id: p.id, label: p.name, quantity: 1, unit_price: p.sales_price }]);
  };

  const setLine = (i, key, value) => {
    const next = [...lines];
    next[i] = { ...next[i], [key]: value };
    if (key === 'product_id') {
      const p = products.find((x) => String(x.id) === String(value));
      if (p) { next[i].unit_price = p.sales_price; next[i].label = p.name; }
    }
    setLines(next);
  };

  const subtotal = useMemo(() => {
    if (!plan) return lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
    return Number(form.quantity) * Number(plan.price) + lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
  }, [plan, form.quantity, lines]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await post('/subscriptions', {
        ...form,
        customer_id: Number(form.customer_id),
        plan_id: Number(form.plan_id),
        quantity: Number(form.quantity),
        duration_cycles: Number(form.duration_cycles),
        lines: lines.map((l) => ({ ...l, product_id: Number(l.product_id), quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
      });
      onCreated?.(res.row);
      onClose();
      setForm({ ...form, customer_id: '', plan_id: '', notes: '', template_id: '' });
      setLines([]);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title="New subscription"
      description="Start from a quotation template or build it line by line."
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.customer_id || !form.plan_id}>
            {busy && <Spinner className="w-4 h-4" />} Create subscription
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}

        <Field label="Start from a quotation template">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={form.template_id} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— No template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} · valid {t.validity_days}d</option>
              ))}
            </Select>
            {form.template_id && (
              <div className="text-[12px] text-ink-500 flex items-center gap-1.5">
                <Icon name="info" className="w-3.5 h-3.5" /> Pre-filled plan, quantities and add-on lines.
              </div>
            )}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" required>
            <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Select a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.company_name || c.name} — {c.email}</option>)}
            </Select>
          </Field>
          <Field label="Plan" required hint={plan ? `Minimum quantity ${plan.min_quantity} · ${cadence(plan.billing_period, plan.interval_count)}` : ''}>
            <Select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {money(p.price, symbol)} / {p.billing_period}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Start date" required>
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Billing cycles" hint="Term length">
            <Input type="number" min="1" value={form.duration_cycles} onChange={(e) => setForm({ ...form, duration_cycles: e.target.value })} />
          </Field>
          <Field label="Quantity" required>
            <Input type="number" min={plan?.min_quantity || 1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </Field>
          <Field label="Payment terms">
            <Select value={form.payment_term} onChange={(e) => setForm({ ...form, payment_term: e.target.value })}>
              {['immediate', 'net7', 'net15', 'net30', 'net45', 'net60'].map((t) => (
                <option key={t} value={t}>{t === 'immediate' ? 'Due on receipt' : titleise(t)}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Add-on lines</label>
            <button className="btn-ghost btn-sm" onClick={addLine}><Icon name="plus" className="w-3.5 h-3.5" /> Add line</button>
          </div>
          {lines.length === 0 ? (
            <p className="text-[12.5px] text-ink-400 rounded-lg border border-dashed border-ink-200 px-3 py-3 text-center">
              No add-ons. The plan itself is always billed first.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)} className="flex-1">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Input type="number" min="1" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className="w-20" />
                  <Input type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} className="w-28" />
                  <button className="btn-ghost btn-sm text-rose-500" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                    <Icon name="trash" className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything the team should know about this deal…" />
        </Field>

        <div className="rounded-lg bg-ink-50 border border-ink-200 px-4 py-3 flex items-center justify-between">
          <span className="text-[13px] text-ink-600">Recurring amount per cycle (before tax)</span>
          <span className="text-[15px] font-semibold text-ink-900 tabular">{money(subtotal, symbol)}</span>
        </div>

        <p className="text-[11.5px] text-ink-400 flex items-start gap-1.5">
          <Icon name="info" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Created as a draft. Move it through Quotation → Confirmed → Active from the subscription page; billing only starts once it is active.
        </p>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* DETAIL                                                                */
/* ==================================================================== */
export function SubscriptionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, canManage, isCustomer } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    get(`/subscriptions/${id}`).then((r) => setRow(r.row)).catch(setError);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (action, reason) => {
    setBusy(true);
    try {
      const res = await post(`/subscriptions/${id}/transition`, { action, reason });
      toast.success(`${titleise(action)} done`, res.row.number);
      setConfirmAction(null);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const billNow = async () => {
    setBusy(true);
    try {
      const res = await post(`/subscriptions/${id}/bill`, {});
      toast.success(`Invoice ${res.invoice.number} created`, money(res.invoice.total, symbol));
      load();
      navigate(`/app/invoices/${res.invoice.id}`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!row) return <Loading />;

  const can = (action) => ({
    draft: ['send_quotation', 'confirm', 'cancel'],
    quotation: ['confirm', 'cancel'],
    confirmed: ['activate', 'cancel'],
    active: ['pause', 'close', 'renew'],
    paused: ['resume', 'close'],
  }[row.state] || []).includes(action);

  return (
    <div className="space-y-5 animate-fade-in">
      <button onClick={() => navigate(-1)} className="text-[12.5px] text-ink-500 hover:text-ink-900 flex items-center gap-1">
        <Icon name="chevronLeft" className="w-3.5 h-3.5" /> Back
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[24px] font-semibold tracking-tight font-mono">{row.number}</h1>
            <StateBadge state={row.state} />
            {row.renewal_count > 0 && <Badge tone="violet">Renewed {row.renewal_count}×</Badge>}
          </div>
          <p className="text-[13.5px] text-ink-500 mt-1">
            {row.company_name || row.customer_name} · {row.plan_name} · {cadence(row.billing_period, row.interval_count)}
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            {can('send_quotation') && <button className="btn-secondary btn-sm" onClick={() => runAction('send_quotation')} disabled={busy}><Icon name="send" className="w-3.5 h-3.5" /> Send quotation</button>}
            {can('confirm') && <button className="btn-primary btn-sm" onClick={() => runAction('confirm')} disabled={busy}><Icon name="check" className="w-3.5 h-3.5" /> Confirm</button>}
            {can('activate') && <button className="btn-primary btn-sm" onClick={() => runAction('activate')} disabled={busy}><Icon name="play" className="w-3.5 h-3.5" /> Activate</button>}
            {can('renew') && <button className="btn-secondary btn-sm" onClick={() => runAction('renew')} disabled={busy}><Icon name="refresh" className="w-3.5 h-3.5" /> Renew</button>}
            {can('pause') && <button className="btn-secondary btn-sm" onClick={() => runAction('pause')} disabled={busy}><Icon name="pause" className="w-3.5 h-3.5" /> Pause</button>}
            {can('resume') && <button className="btn-secondary btn-sm" onClick={() => runAction('resume')} disabled={busy}><Icon name="play" className="w-3.5 h-3.5" /> Resume</button>}
            {row.state === 'active' && <button className="btn-primary btn-sm" onClick={billNow} disabled={busy}><Icon name="receipt" className="w-3.5 h-3.5" /> Bill now</button>}
            {can('close') && <button className="btn-secondary btn-sm text-rose-600" onClick={() => setConfirmAction('close')} disabled={busy}>Close</button>}
            {can('cancel') && <button className="btn-ghost btn-sm text-rose-600" onClick={() => setConfirmAction('cancel')} disabled={busy}>Cancel deal</button>}
            <button className="btn-ghost btn-sm" onClick={() => setEditOpen(true)}><Icon name="edit" className="w-3.5 h-3.5" /> Edit</button>
          </div>
        )}
      </div>

      {/* Lifecycle stepper */}
      <Card className="px-5 py-4">
        <div className="flex items-center overflow-x-auto">
          {['draft', 'quotation', 'confirmed', 'active', 'closed'].map((s, i, arr) => {
            const order = { draft: 0, quotation: 1, confirmed: 2, active: 3, paused: 3, closed: 4, cancelled: 4 };
            const current = order[row.state] ?? 0;
            const done = order[s] < current || (row.state === s);
            const isNow = row.state === s || (row.state === 'paused' && s === 'active');
            return (
              <div key={s} className="flex items-center flex-1 min-w-fit">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10.5px] font-bold shrink-0
                    ${isNow ? 'bg-brand-600 text-white ring-4 ring-brand-100' : done ? 'bg-emerald-500 text-white' : 'bg-ink-100 text-ink-400'}`}>
                    {done && !isNow ? <Icon name="check" className="w-3 h-3" strokeWidth={3} /> : i + 1}
                  </div>
                  <span className={`text-[12.5px] capitalize whitespace-nowrap ${isNow ? 'font-semibold text-ink-900' : done ? 'text-ink-600' : 'text-ink-400'}`}>
                    {row.state === 'paused' && s === 'active' ? 'active (paused)' : s}
                  </span>
                </div>
                {i < arr.length - 1 && <div className={`h-px flex-1 mx-3 min-w-[20px] ${done ? 'bg-emerald-300' : 'bg-ink-200'}`} />}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {/* Lines */}
          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-ink-100">
              <h3 className="text-[14px] font-semibold text-ink-900">Subscription lines</h3>
              <p className="text-[12px] text-ink-500 mt-0.5">What gets copied onto every invoice</p>
            </div>
            <Table
              dense
              columns={[
                { key: 'label', label: 'Description', render: (r) => (
                  <div>
                    <div className="text-[13px] font-medium text-ink-900">{r.label || r.product_name}</div>
                    {r.is_plan_line ? <span className="text-[10.5px] text-brand-600 font-semibold uppercase tracking-wide">Plan</span>
                      : <span className="text-[10.5px] text-ink-400">Add-on</span>}
                  </div>
                ) },
                { key: 'quantity', label: 'Qty', align: 'right', render: (r) => <span className="tabular">{r.quantity}</span> },
                { key: 'unit_price', label: 'Unit price', align: 'right', render: (r) => <span className="tabular">{money(r.unit_price, symbol)}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.quantity * r.unit_price, symbol)}</span> },
              ]}
              rows={row.lines}
            />
            <div className="px-5 py-3 border-t border-ink-100 bg-ink-50/60 flex justify-between items-center">
              <span className="text-[12.5px] text-ink-500">Recurring per cycle, before tax</span>
              <span className="text-[15px] font-semibold text-ink-900 tabular">
                {money(row.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0), symbol)}
              </span>
            </div>
          </Card>

          {/* Invoices */}
          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-ink-100 flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-semibold text-ink-900">Invoices</h3>
                <p className="text-[12px] text-ink-500 mt-0.5">{row.invoices.length} generated from this subscription</p>
              </div>
              <Link to={`/app/invoices?subscription_id=${row.id}`} className="text-[12.5px] link">All invoices</Link>
            </div>
            <Table
              dense
              columns={[
                { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
                { key: 'period', label: 'Period', render: (r) => <span className="text-[12px] text-ink-600">{date(r.period_start)} – {date(r.period_end)}</span> },
                { key: 'due_date', label: 'Due', render: (r) => <span className="text-[12px] text-ink-500">{date(r.due_date)}</span> },
                { key: 'state', label: 'Status', render: (r) => <StateBadge state={r.state} /> },
                { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total, symbol)}</span> },
                {
                  key: 'balance', label: 'Balance', align: 'right',
                  render: (r) => <span className={`tabular ${r.balance > 0 ? 'text-amber-700' : 'text-ink-400'}`}>{money(r.balance, symbol)}</span>,
                },
              ]}
              rows={row.invoices}
              onRowClick={(r) => navigate(`/app/invoices/${r.id}`)}
              empty={<EmptyState icon="receipt" title="No invoices yet" description="Invoices appear here as soon as this subscription is billed." />}
            />
          </Card>
        </div>

        {/* Side rail */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-ink-900 mb-3">Contract</h3>
            <dl>
              <DetailRow label="Customer">
                <Link to={`/app/customers/${row.customer_id}`} className="link">{row.company_name || row.customer_name}</Link>
              </DetailRow>
              <DetailRow label="Billed to">{row.customer_email}</DetailRow>
              <DetailRow label="Plan">{row.plan_name}</DetailRow>
              <DetailRow label="Cadence">{cadence(row.billing_period, row.interval_count)}</DetailRow>
              <DetailRow label="Quantity">{num(row.quantity)}</DetailRow>
              <DetailRow label="Unit price">{money(row.unit_price, symbol)}</DetailRow>
              <DetailRow label="MRR">{money(row.mrr, symbol)}</DetailRow>
              <DetailRow label="Start date">{date(row.start_date)}</DetailRow>
              <DetailRow label="Expiry date">{date(row.expiry_date)}</DetailRow>
              <DetailRow label="Payment terms">{row.payment_term === 'immediate' ? 'Due on receipt' : titleise(row.payment_term)}</DetailRow>
              <DetailRow label="Auto-renew">{row.auto_renew ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</DetailRow>
              <DetailRow label="Next billing">
                {row.next_billing_date ? (
                  <span className={daysUntil(row.next_billing_date) < 0 ? 'text-rose-600' : ''}>
                    {date(row.next_billing_date)} <span className="text-ink-400 font-normal">({relative(row.next_billing_date)})</span>
                  </span>
                ) : '—'}
              </DetailRow>
              {row.close_reason && <DetailRow label="Close reason">{row.close_reason}</DetailRow>}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-ink-900 mb-1">Plan rules</h3>
            <p className="text-[12px] text-ink-500 mb-3">What the admin allowed for this plan</p>
            <div className="space-y-2">
              {[
                ['Can be paused', row.allow_pause],
                ['Can be closed early', row.allow_close],
                ['Can be renewed', row.allow_renew],
                ['Auto-close at term end', row.close_on_end],
              ].map(([label, on]) => (
                <div key={label} className="flex items-center justify-between text-[12.5px]">
                  <span className="text-ink-600">{label}</span>
                  <Icon name={on ? 'check' : 'close'} className={`w-4 h-4 ${on ? 'text-emerald-500' : 'text-ink-300'}`} strokeWidth={2.4} />
                </div>
              ))}
              <div className="flex items-center justify-between text-[12.5px] pt-2 border-t border-ink-100">
                <span className="text-ink-600">Max renewals</span>
                <span className="font-medium text-ink-900">{row.max_renewals === 0 ? 'Unlimited' : row.max_renewals}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-ink-900 mb-3">History</h3>
            <ol className="relative space-y-3 pl-4 border-l border-ink-200">
              {row.timeline.length === 0 && <p className="text-[12.5px] text-ink-400 -ml-4">No activity recorded yet.</p>}
              {row.timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-brand-400 ring-2 ring-white" />
                  <div className="text-[12.5px] text-ink-800 leading-snug">{t.summary}</div>
                  <div className="text-[11px] text-ink-400 mt-0.5">{t.actor} · {date(t.created_at)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === 'close'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => runAction('close', 'Closed early by the team')}
        title="Close this subscription?"
        message="Billing stops immediately and the contract moves to Closed. Existing invoices are unaffected."
        confirmLabel="Close subscription" tone="danger" busy={busy}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => runAction('cancel', 'Cancelled before activation')}
        title="Cancel this deal?"
        message="The subscription will be marked cancelled and no invoices will be raised."
        confirmLabel="Cancel deal" tone="danger" busy={busy}
      />
      <EditSubscriptionModal open={editOpen} onClose={() => setEditOpen(false)} row={row} onSaved={load} />
    </div>
  );
}

function EditSubscriptionModal({ open, onClose, row, onSaved }) {
  const [form, setForm] = useState({ quantity: row.quantity, unit_price: row.unit_price, payment_term: row.payment_term, expiry_date: row.expiry_date, notes: row.notes || '', auto_renew: row.auto_renew });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (open) setForm({ quantity: row.quantity, unit_price: row.unit_price, payment_term: row.payment_term, expiry_date: row.expiry_date, notes: row.notes || '', auto_renew: row.auto_renew });
  }, [open, row]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await patch(`/subscriptions/${row.id}`, {
        quantity: Number(form.quantity), unit_price: Number(form.unit_price),
        payment_term: form.payment_term, expiry_date: form.expiry_date, notes: form.notes,
        auto_renew: form.auto_renew ? 1 : 0,
      });
      toast.success('Subscription updated');
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${row.number}`}
      description="Changes apply to future invoices, not ones already issued."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy && <Spinner className="w-4 h-4" />} Save changes</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantity"><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          <Field label="Unit price"><Input type="number" min="0" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} /></Field>
          <Field label="Payment terms">
            <Select value={form.payment_term} onChange={(e) => setForm({ ...form, payment_term: e.target.value })}>
              {['immediate', 'net7', 'net15', 'net30', 'net45', 'net60'].map((t) => <option key={t} value={t}>{titleise(t)}</option>)}
            </Select>
          </Field>
          <Field label="Expiry date"><Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
