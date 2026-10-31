import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, patch } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PasswordRules } from './auth.jsx';
import {
  Badge, Card, DetailRow, EmptyState, ErrorState, Field, Icon, Input, Loading, Modal,
  SectionHeader, Select, Spinner, StateBadge, StatCard, Table, Tabs, Textarea, useToast,
} from '../components/ui.jsx';
import { cadence, date, daysUntil, money, num, relative, titleise } from '../lib/format.js';

/* ==================================================================== */
/* OVERVIEW                                                              */
/* ==================================================================== */
export function PortalHomePage() {
  const { user, settings } = useAuth();
  const navigate = useNavigate();
  const symbol = settings?.currency_symbol || '₹';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    get('/portal/summary').then(setData).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading />;

  const active = data.subscriptions.filter((s) => s.state === 'active');

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow={`Welcome back, ${user.name.split(' ')[0]}`}
        title="Your billing overview"
        description="Manage your subscriptions and settle invoices without emailing anyone."
        actions={
          <>
            <Link to="/portal/plans" className="btn-secondary btn-sm"><Icon name="layers" className="w-3.5 h-3.5" /> Browse plans</Link>
            <Link to="/portal/invoices" className="btn-primary btn-sm"><Icon name="receipt" className="w-3.5 h-3.5" /> Pay invoices</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active subscriptions" value={num(active.length)} icon="refresh" tone="green" onClick={() => navigate('/portal/subscriptions')} />
        <StatCard label="Monthly spend" value={money(data.monthly_spend, symbol)} sub="Normalised across cycles" icon="trending" tone="brand" />
        <StatCard label="Amount due" value={money(data.outstanding.amount, symbol)} sub={`${data.outstanding.count} open invoice(s)`} icon="clock" tone={data.outstanding.amount > 0 ? 'amber' : 'ink'} onClick={() => navigate('/portal/invoices')} />
        <StatCard label="Paid to date" value={money(data.lifetime_paid, symbol)} icon="wallet" tone="sky" />
      </div>

      {data.outstanding.amount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-3">
          <Icon name="alert" className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-[13px] text-amber-900 flex-1 min-w-[200px]">
            You have {data.outstanding.count} unpaid invoice(s) totalling <strong>{money(data.outstanding.amount, symbol)}</strong>.
          </p>
          <Link to="/portal/invoices" className="btn-primary btn-sm">View invoices</Link>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h3 className="text-[14px] font-semibold text-ink-900">My subscriptions</h3>
            <Link to="/portal/subscriptions" className="text-[12.5px] link">View all</Link>
          </div>
          <Table
            dense
            columns={[
              { key: 'number', label: 'Subscription', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
              { key: 'plan_name', label: 'Plan', render: (r) => <div><div className="text-[12.5px]">{r.plan_name}</div><div className="text-[11px] text-ink-400">{cadence(r.billing_period, r.interval_count)}</div></div> },
              { key: 'state', label: 'Status', render: (r) => <StateBadge state={r.state} /> },
              { key: 'mrr', label: 'Monthly', align: 'right', render: (r) => <span className="tabular">{money(r.mrr, symbol)}</span> },
            ]}
            rows={data.subscriptions.slice(0, 5)}
            empty={<EmptyState icon="layers" title="No subscriptions yet" description="Browse the catalogue and request a plan — the team confirms it for you." action={<Link to="/portal/plans" className="btn-primary btn-sm">Browse plans</Link>} />}
          />
        </Card>

        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink-900 mb-3">Next payments</h3>
          {data.upcoming.length === 0 ? (
            <p className="text-[12.5px] text-ink-400">Nothing scheduled.</p>
          ) : (
            <div className="space-y-3">
              {data.upcoming.map((u) => {
                const d = daysUntil(u.next_billing_date);
                return (
                  <div key={u.id} className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                      <Icon name="calendar" className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-ink-900 truncate">{u.plan_name}</div>
                      <div className="text-[11px] text-ink-500">{date(u.next_billing_date)} · {relative(u.next_billing_date)}</div>
                      {d <= 3 && <div className="text-[10.5px] text-amber-600 font-medium mt-0.5">Billing soon</div>}
                    </div>
                    <span className="text-[12.5px] font-semibold tabular text-ink-900">{money(u.unit_price * u.quantity, symbol)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-ink-100">
            <Link to="/portal/profile" className="btn-secondary btn-sm w-full"><Icon name="user" className="w-3.5 h-3.5" /> Profile & security</Link>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-[14px] font-semibold text-ink-900">Recent invoices</h3>
          <Link to="/portal/invoices" className="text-[12.5px] link">View all</Link>
        </div>
        <Table
          dense
          columns={[
            { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
            { key: 'invoice_date', label: 'Issued', render: (r) => <span className="text-[12px] text-ink-600">{date(r.invoice_date)}</span> },
            { key: 'due_date', label: 'Due', render: (r) => <span className="text-[12px] text-ink-600">{date(r.due_date)}</span> },
            { key: 'state', label: 'Status', render: (r) => <StateBadge state={r.state} /> },
            { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total, symbol)}</span> },
            { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className={`tabular ${r.balance > 0 ? 'text-amber-700 font-medium' : 'text-ink-300'}`}>{money(r.balance, symbol)}</span> },
          ]}
          rows={data.invoices.slice(0, 6)}
          onRowClick={(r) => navigate(`/portal/invoices/${r.id}`)}
        />
      </Card>
    </div>
  );
}

/* ==================================================================== */
/* PLAN CATALOGUE                                                        */
/* ==================================================================== */
export function PortalCatalogPage() {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [cycle, setCycle] = useState('all');

  const load = useCallback(() => { get('/portal/catalog').then((r) => setRows(r.rows)).catch(setError); }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = (rows || []).filter((p) => cycle === 'all' || p.billing_period === cycle);

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Catalogue"
        title="Available plans"
        description="Pick what fits. Requesting a plan raises a quotation for our team — nothing is charged until you confirm."
        actions={<Tabs tabs={[{ id: 'all', label: 'All' }, { id: 'monthly', label: 'Monthly' }, { id: 'yearly', label: 'Yearly' }, { id: 'weekly', label: 'Weekly' }, { id: 'daily', label: 'Daily' }]} value={cycle} onChange={setCycle} />}
      />

      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? <Loading /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 && <div className="col-span-full"><Card><EmptyState icon="layers" title="No plans available" description="Check back soon." /></Card></div>}
          {filtered.map((p) => (
            <Card key={p.id} className="p-5 flex flex-col hover:shadow-lift transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-900">{p.name}</h3>
                  <p className="text-[11.5px] text-ink-500 mt-0.5">{p.product_name}</p>
                </div>
                <Badge tone="brand">{titleise(p.billing_period)}</Badge>
              </div>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-[26px] font-semibold tracking-tight text-ink-900 tabular">{money(p.price, symbol)}</span>
                <span className="text-[12px] text-ink-500">/ {p.billing_period === 'daily' ? 'day' : p.billing_period === 'weekly' ? 'week' : p.billing_period === 'monthly' ? 'month' : 'year'}</span>
              </div>
              <p className="text-[11.5px] text-ink-400">{cadence(p.billing_period, p.interval_count)} · minimum {p.min_quantity} seat(s)</p>

              <p className="text-[12.5px] text-ink-600 mt-3 flex-1 leading-relaxed">{p.product_notes || 'A Brightloop subscription plan.'}</p>

              <div className="mt-3 space-y-1 text-[11.5px]">
                {p.variants?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.variants.slice(0, 4).map((v) => (
                      <span key={v.id} className="chip bg-ink-50 text-ink-600 ring-ink-200">{v.attribute_value}{v.price_extra ? ` +${money(v.price_extra, symbol)}` : ''}</span>
                    ))}
                  </div>
                )}
                {p.tax_summary && <div className="text-ink-400 flex items-center gap-1"><Icon name="percent" className="w-3 h-3" /> {p.tax_summary}</div>}
                <div className="text-ink-400 flex items-center gap-1">
                  <Icon name={p.allow_pause ? 'check' : 'close'} className="w-3 h-3" /> {p.allow_pause ? 'Can pause' : 'No pausing'}
                  <span className="mx-1">·</span>
                  <Icon name={p.allow_close ? 'check' : 'close'} className="w-3 h-3" /> {p.allow_close ? 'Cancel any time' : 'Fixed term'}
                </div>
              </div>

              <button className="btn-primary w-full mt-4" onClick={() => setSelected(p)}>Request this plan</button>
            </Card>
          ))}
        </div>
      )}

      <RequestPlanModal open={!!selected} onClose={() => setSelected(null)} plan={selected} symbol={symbol}
        onDone={() => { toast.success('Request submitted', 'Our team will confirm your subscription shortly'); load(); }} />
    </div>
  );
}

function RequestPlanModal({ open, onClose, plan, symbol, onDone }) {
  const [form, setForm] = useState({ quantity: 1, start_date: new Date().toISOString().slice(0, 10), notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open && plan) setForm({ quantity: plan.min_quantity || 1, start_date: new Date().toISOString().slice(0, 10), notes: '' }); }, [open, plan]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await post('/portal/subscribe', { ...form, plan_id: plan.id, quantity: Number(form.quantity) });
      onDone(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!open || !plan) return null;
  const total = plan.price * Number(form.quantity || 1);

  return (
    <Modal open={open} onClose={onClose} title={`Request ${plan.name}`}
      description="Our team will review and confirm this request — you'll see it in your subscriptions straight away."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy && <Spinner className="w-4 h-4" />} Submit request</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantity / seats" required hint={`Minimum ${plan.min_quantity}`}>
            <Input type="number" min={plan.min_quantity} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </Field>
          <Field label="Preferred start date"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
        </div>
        <Field label="Anything we should know?"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="rounded-lg bg-ink-50 border border-ink-200 px-4 py-3 flex items-center justify-between">
          <span className="text-[13px] text-ink-600">Per {plan.billing_period === 'monthly' ? 'month' : plan.billing_period === 'yearly' ? 'year' : plan.billing_period === 'weekly' ? 'week' : 'day'}</span>
          <span className="text-[16px] font-semibold text-ink-900 tabular">{money(total, symbol)}</span>
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* MY SUBSCRIPTIONS                                                      */
/* ==================================================================== */
export function PortalSubscriptionsPage() {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => { get('/portal/summary').then(setData).catch(setError); }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader eyebrow="My account" title="Subscriptions"
        description="Everything you have with Brightloop. Need a change? Any adjustment here is picked up by our team automatically." />

      {data.subscriptions.length === 0 ? (
        <Card><EmptyState icon="layers" title="No subscriptions yet" description="Browse the catalogue to get started."
          action={<Link to="/portal/plans" className="btn-primary btn-sm">Browse plans</Link>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.subscriptions.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14.5px] font-semibold text-ink-900">{s.plan_name}</h3>
                    <StateBadge state={s.state} />
                  </div>
                  <p className="font-mono text-[11.5px] text-ink-400 mt-1">{s.number}</p>
                </div>
                <div className="text-right">
                  <div className="text-[16px] font-semibold text-ink-900 tabular">{money(s.mrr, symbol)}</div>
                  <div className="text-[10.5px] text-ink-400">per month</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Mini label="Product" value={s.product_name} />
                <Mini label="Billing" value={cadence(s.billing_period, s.interval_count)} />
                <Mini label="Seats" value={num(s.quantity)} />
                <Mini label="Per cycle" value={money(s.unit_price * s.quantity, symbol)} />
                <Mini label="Started" value={date(s.start_date)} />
                <Mini label="Renews / ends" value={date(s.expiry_date)} />
              </div>

              {s.state === 'active' && s.next_billing_date && (
                <div className="mt-3 rounded-lg bg-brand-50 border border-brand-200 px-3 py-2 flex items-center gap-2">
                  <Icon name="calendar" className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                  <span className="text-[12px] text-brand-800">Next invoice {date(s.next_billing_date)} · {relative(s.next_billing_date)}</span>
                </div>
              )}

              <Link to={`/portal/invoices?subscription=${s.id}`} className="btn-secondary btn-sm w-full mt-3">
                <Icon name="receipt" className="w-3.5 h-3.5" /> View invoices
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const Mini = ({ label, value }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
    <div className="text-[12.5px] text-ink-800 font-medium truncate">{value}</div>
  </div>
);

/* ==================================================================== */
/* MY INVOICES                                                           */
/* ==================================================================== */
export function PortalInvoicesPage() {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setError(null);
    const query = { limit: 50 };
    if (['outstanding', 'overdue', 'paid'].includes(filter)) query.status = filter;
    else if (filter) query.state = filter;
    get('/invoices', query).then(setData).catch(setError);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader eyebrow="Billing" title="My invoices"
        description="Download or print any invoice. Outstanding amounts are shown with their due dates."
        actions={<Tabs tabs={[{ id: '', label: 'All' }, { id: 'outstanding', label: 'Unpaid' }, { id: 'paid', label: 'Paid' }]} value={filter} onChange={setFilter} />}
      />

      {!data ? <Loading /> : (
        <Card className="overflow-hidden">
          <Table
            columns={[
              { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-[12.5px] font-semibold text-brand-700">{r.number}</span> },
              { key: 'invoice_date', label: 'Issued', render: (r) => <span className="text-[12.5px] text-ink-600">{date(r.invoice_date)}</span> },
              { key: 'due_date', label: 'Due', render: (r) => <span className={`text-[12.5px] ${r.balance > 0 && daysUntil(r.due_date) < 0 ? 'text-rose-600 font-medium' : 'text-ink-600'}`}>{date(r.due_date)}</span> },
              { key: 'state', label: 'Status', render: (r) => r.is_overdue ? <Badge tone="red">Overdue</Badge> : <StateBadge state={r.state} /> },
              { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total, symbol)}</span> },
              { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className={`tabular ${r.balance > 0 ? 'text-amber-700 font-semibold' : 'text-ink-300'}`}>{money(r.balance, symbol)}</span> },
              { key: 'go', label: '', align: 'right', render: () => <Icon name="chevronRight" className="w-4 h-4 text-ink-300 inline" /> },
            ]}
            rows={data.rows.filter((r) => r.state !== 'draft')}
            onRowClick={(r) => navigate(`/portal/invoices/${r.id}`)}
            empty={<EmptyState icon="receipt" title="No invoices" description="Invoices appear here once your subscription is billed." />}
          />
        </Card>
      )}
    </div>
  );
}

/* Read-only invoice view for customers, reusing the same sheet design. */
export function PortalInvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);
  const toast = useToast();

  useEffect(() => { get(`/invoices/${id}`).then((r) => setRow(r.row)).catch(setError); }, [id]);

  if (error) return <ErrorState error={error} />;
  if (!row) return <Loading />;

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <button onClick={() => navigate('/portal/invoices')} className="text-[12.5px] text-ink-500 hover:text-ink-900 flex items-center gap-1">
          <Icon name="chevronLeft" className="w-3.5 h-3.5" /> Back to invoices
        </button>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => window.print()}><Icon name="print" className="w-3.5 h-3.5" /> Print / save PDF</button>
          <button className="btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(row.number); toast.success('Invoice number copied'); }}>
            <Icon name="copy" className="w-3.5 h-3.5" /> Copy reference
          </button>
        </div>
      </div>

      <Card className="print-area p-8">
        <div className="flex flex-wrap justify-between gap-4 pb-6 border-b border-ink-200">
          <div>
            <div className="text-[16px] font-semibold text-ink-900">{row.company.company_name}</div>
            <div className="text-[11.5px] text-ink-500 mt-1 whitespace-pre-line">{row.company.company_address}</div>
            <div className="text-[11.5px] text-ink-500">{row.company.company_email}</div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-ink-400 font-semibold">Invoice</div>
            <div className="text-[19px] font-semibold font-mono">{row.number}</div>
            <div className="text-[11.5px] text-ink-500 mt-1">Issued {date(row.invoice_date)}</div>
            <div className="text-[11.5px] text-ink-500">Due {date(row.due_date)}</div>
            <div className="mt-2">{row.state === 'paid' ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">{money(row.balance, symbol)} due</Badge>}</div>
          </div>
        </div>

        <table className="w-full mt-6">
          <thead><tr className="border-b border-ink-200">
            <th className="text-left text-[10.5px] uppercase tracking-wider text-ink-400 pb-2">Description</th>
            <th className="text-right text-[10.5px] uppercase tracking-wider text-ink-400 pb-2 w-16">Qty</th>
            <th className="text-right text-[10.5px] uppercase tracking-wider text-ink-400 pb-2 w-24">Amount</th>
          </tr></thead>
          <tbody className="divide-y divide-ink-100">
            {row.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2.5 text-[13px]">{l.description}{l.discount_amount > 0 && <span className="text-[11px] text-emerald-600 ml-2">−{money(l.discount_amount, symbol)}</span>}</td>
                <td className="py-2.5 text-right text-[13px] text-ink-600 tabular">{l.quantity}</td>
                <td className="py-2.5 text-right text-[13px] font-medium tabular">{money(l.amount, symbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 pt-4 border-t border-ink-200 flex justify-end">
          <div className="w-[260px] space-y-1.5">
            <div className="flex justify-between text-[12.5px]"><span className="text-ink-500">Subtotal</span><span className="tabular">{money(row.subtotal, symbol)}</span></div>
            {row.discount_total > 0 && <div className="flex justify-between text-[12.5px]"><span className="text-ink-500">Discount</span><span className="tabular text-emerald-600">− {money(row.discount_total, symbol)}</span></div>}
            {row.taxes.map((t) => <div key={t.id} className="flex justify-between text-[12.5px]"><span className="text-ink-400">{t.name}</span><span className="tabular text-ink-500">{money(t.amount, symbol)}</span></div>)}
            <div className="flex justify-between pt-2 border-t border-ink-200"><span className="text-[13px] font-semibold">Total</span><span className="text-[16px] font-semibold tabular">{money(row.total, symbol)}</span></div>
            <div className={`flex justify-between rounded-lg px-3 py-2 ${row.balance > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
              <span className="text-[12.5px] font-semibold">{row.balance > 0 ? 'Amount due' : 'Settled'}</span>
              <span className={`text-[15px] font-semibold tabular ${row.balance > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>{money(row.balance, symbol)}</span>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ink-400 italic mt-4">{row.amount_in_words}</p>
      </Card>

      <Card className="p-5 no-print">
        <h3 className="text-[14px] font-semibold mb-2">How to pay</h3>
        <p className="text-[12.5px] text-ink-600 leading-relaxed">
          Transfer to the account shown on your agreement and quote the invoice number
          <span className="font-mono font-medium text-ink-900"> {row.number} </span>
          as the reference. Your payment is matched and the invoice closes automatically.
        </p>
        <dl className="mt-3">
          <DetailRow label="Bank">{row.company.company_name}</DetailRow>
          <DetailRow label="Reference">{row.number}</DetailRow>
          <DetailRow label="Support">{row.company.company_email}</DetailRow>
        </dl>
      </Card>
    </div>
  );
}

/* ==================================================================== */
/* MY PAYMENTS                                                           */
/* ==================================================================== */
export function PortalPaymentsPage() {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { get('/payments', { limit: 50 }).then(setData).catch(setError); }, []);
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader eyebrow="Billing" title="Payment history"
        description="Every payment we have recorded against your account." />

      <Card className="overflow-hidden">
        <Table
          columns={[
            { key: 'number', label: 'Receipt', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
            { key: 'payment_date', label: 'Date', render: (r) => <span className="text-[12.5px] text-ink-600">{date(r.payment_date)}</span> },
            { key: 'invoice_number', label: 'Invoice', render: (r) => <span className="font-mono text-[12px] text-brand-700">{r.invoice_number}</span> },
            { key: 'method', label: 'Method', render: (r) => <Badge>{titleise(r.method)}</Badge> },
            { key: 'reference', label: 'Reference', render: (r) => <span className="text-[11.5px] font-mono text-ink-400">{r.reference || '—'}</span> },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="tabular font-semibold text-emerald-700">{money(r.amount, symbol)}</span> },
          ]}
          rows={data.rows}
          empty={<EmptyState icon="wallet" title="No payments yet" description="Payments recorded against your invoices will appear here." />}
        />
      </Card>
    </div>
  );
}

/* ==================================================================== */
/* PROFILE                                                               */
/* ==================================================================== */
export function PortalProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', company_name: '', phone: '', address: '', city: '', country: '', tax_id: '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) setForm({ name: user.name, company_name: user.company_name || '', phone: user.phone || '', address: user.address || '', city: user.city || '', country: user.country || '', tax_id: user.tax_id || '' });
  }, [user]);

  const saveProfile = async () => {
    setBusy('p');
    try { await patch(`/users/${user.id}`, form); await refresh(); toast.success('Profile updated'); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const changePassword = async () => {
    setError('');
    if (pw.new_password !== pw.confirm) { setError('Passwords do not match.'); return; }
    setBusy('pw');
    try {
      await post('/auth/change-password', { current_password: pw.current_password, new_password: pw.new_password });
      toast.success('Password changed');
      setPw({ current_password: '', new_password: '', confirm: '' });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  if (!user) return <Loading />;

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <SectionHeader eyebrow="My account" title="Profile & security"
        description="Keep your billing details current — they appear on every invoice we issue to you." />

      <Card className="p-5 space-y-4">
        <h3 className="text-[14px] font-semibold text-ink-900">Billing details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Company"><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="GSTIN / Tax ID"><Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} /></Field>
          <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="Country"><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
        </div>
        <Field label="Billing address"><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-ink-400">Signed in as {user.email}</span>
          <button className="btn-primary" onClick={saveProfile} disabled={busy === 'p'}>{busy === 'p' && <Spinner className="w-4 h-4" />} Save details</button>
        </div>
      </Card>

      <Card className="p-5 space-y-4 max-w-lg">
        <h3 className="text-[14px] font-semibold text-ink-900">Change password</h3>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <Field label="Current password"><Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
        <Field label="New password">
          <Input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <PasswordRules password={pw.new_password} />
        </Field>
        <Field label="Confirm new password"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        <button className="btn-primary w-full" onClick={changePassword} disabled={busy === 'pw' || !pw.current_password || !pw.new_password}>
          {busy === 'pw' && <Spinner className="w-4 h-4" />} Update password
        </button>
      </Card>
    </div>
  );
}
