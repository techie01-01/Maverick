import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { get, downloadCsv } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Card, EmptyState, ErrorState, Field, Icon, Input, Loading, SectionHeader, Select,
  StatCard, Table, Tabs, useToast,
} from '../components/ui.jsx';
import { date, money, moneyShort, num, pct, titleise, today } from '../lib/format.js';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#f43f5e'];

const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

export default function ReportsPage() {
  const { settings } = useAuth();
  const navigate = useNavigate();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [tab, setTab] = useState('revenue');
  const [range, setRange] = useState({ from: firstOfYear(), to: today() });
  const [groupBy, setGroupBy] = useState('month');
  const [revenue, setRevenue] = useState(null);
  const [receivables, setReceivables] = useState(null);
  const [subsReport, setSubsReport] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      get('/reports/revenue', { ...range, groupBy }),
      get('/reports/receivables'),
      get('/reports/subscriptions'),
      get('/reports/dashboard'),
    ]).then(([r, rc, s, d]) => {
      setRevenue(r); setReceivables(rc); setSubsReport(s); setDashboard(d);
    }).catch(setError).finally(() => setLoading(false));
  }, [range, groupBy]);

  useEffect(() => { load(); }, [load]);

  const quick = (days) => {
    const to = today();
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    setRange({ from, to });
  };

  const k = dashboard?.kpis;

  const totals = useMemo(() => {
    const rows = revenue?.rows || [];
    return rows.reduce((acc, r) => ({
      invoiced: acc.invoiced + Number(r.invoiced || 0),
      paid: acc.paid + Number(r.paid || r.amount || 0),
      outstanding: acc.outstanding + Number(r.outstanding || 0),
      tax: acc.tax + Number(r.tax || 0),
      discounts: acc.discounts + Number(r.discounts || 0),
    }), { invoiced: 0, paid: 0, outstanding: 0, tax: 0, discounts: 0 });
  }, [revenue]);

  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Finance"
        title="Reports"
        description="One place for active subscriptions, revenue, collections and overdue invoices — with filters and a summary, no quarter-end scramble."
        actions={
          <button className="btn-secondary btn-sm" onClick={() => downloadCsv('/reports/export.csv', { type: 'invoices', ...range }).catch((e) => toast.error(e.message))}>
            <Icon name="download" className="w-3.5 h-3.5" /> Export invoices
          </button>
        }
      />

      {/* Filter bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-[150px]"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To" className="w-[150px]"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <Field label="Group by" className="w-[170px]">
            <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="month">Month</option>
              <option value="customer">Customer</option>
              <option value="plan">Plan</option>
              <option value="method">Payment method</option>
            </Select>
          </Field>
          <div className="flex gap-1.5 pb-0.5">
            {[['30 days', 30], ['90 days', 90], ['12 months', 365], ['YTD', null]].map(([label, days]) => (
              <button key={label} className="btn-secondary btn-sm"
                onClick={() => days ? quick(days) : setRange({ from: firstOfYear(), to: today() })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Invoiced" value={moneyShort(totals.invoiced, symbol)} icon="receipt" tone="brand" />
        <StatCard label="Collected" value={moneyShort(totals.paid, symbol)} icon="wallet" tone="green" />
        <StatCard label="Outstanding" value={moneyShort(totals.outstanding, symbol)} icon="clock" tone="amber" />
        <StatCard label="Tax collected" value={moneyShort(totals.tax, symbol)} icon="percent" tone="violet" />
        <StatCard label="Discounts given" value={moneyShort(totals.discounts, symbol)} icon="tag" tone="sky" />
      </div>

      <Tabs
        tabs={[
          { id: 'revenue', label: 'Revenue' },
          { id: 'receivables', label: 'Receivables & ageing', count: receivables?.rows?.length },
          { id: 'subscriptions', label: 'Subscription base' },
        ]}
        value={tab} onChange={setTab}
      />

      {/* ---------------- REVENUE ---------------- */}
      {tab === 'revenue' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-semibold text-ink-900">
                  {groupBy === 'month' ? 'Revenue trend' : groupBy === 'customer' ? 'Revenue by customer'
                    : groupBy === 'plan' ? 'Revenue by plan' : 'Collections by method'}
                </h3>
                <p className="text-[12px] text-ink-500 mt-0.5">{date(range.from)} – {date(range.to)}</p>
              </div>
              {loading && <span className="text-[11px] text-ink-400">updating…</span>}
            </div>

            <div className="h-[300px] mt-5 -ml-3">
              {loading && !revenue ? <Loading /> : (
                <ResponsiveContainer width="100%" height="100%">
                  {groupBy === 'month' ? (
                    <AreaChart data={revenue.rows} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rInv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.25} /><stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="rPaid" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eceef6" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false} tickFormatter={(v) => moneyShort(v, symbol)} width={66} />
                      <Tooltip content={<Tip symbol={symbol} />} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Area isAnimationActive={false} type="monotone" dataKey="invoiced" name="Invoiced" stroke="#4f46e5" strokeWidth={2} fill="url(#rInv)" />
                      <Area isAnimationActive={false} type="monotone" dataKey="paid" name="Collected" stroke="#10b981" strokeWidth={2} fill="url(#rPaid)" />
                    </AreaChart>
                  ) : (
                    <BarChart data={revenue.rows.slice(0, 12)} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eceef6" vertical={false} />
                      <XAxis dataKey={groupBy === 'customer' ? 'name' : groupBy === 'plan' ? 'name' : 'method'}
                        tickFormatter={(v) => String(v).length > 12 ? `${String(v).slice(0, 11)}…` : v}
                        tick={{ fontSize: 10.5, fill: '#8791b4' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false} tickFormatter={(v) => moneyShort(v, symbol)} width={66} />
                      <Tooltip content={<Tip symbol={symbol} />} />
                      <Bar isAnimationActive={false} dataKey={groupBy === 'method' ? 'amount' : 'invoiced'} name={groupBy === 'method' ? 'Collected' : 'Invoiced'}
                        fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={46} />
                      {groupBy !== 'method' && <Bar isAnimationActive={false} dataKey="paid" name="Collected" fill="#10b981" radius={[5, 5, 0, 0]} maxBarSize={46} />}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-ink-900">Detail</h3>
              <button className="btn-secondary btn-sm" onClick={() => downloadCsv('/reports/export.csv', { type: 'invoices', ...range }).catch((e) => toast.error(e.message))}>
                <Icon name="download" className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
            <Table
              columns={groupBy === 'month' ? [
                { key: 'period', label: 'Period' },
                { key: 'invoices', label: 'Invoices', align: 'right' },
                { key: 'invoiced', label: 'Invoiced', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.invoiced, symbol)}</span> },
                { key: 'paid', label: 'Collected', align: 'right', render: (r) => <span className="tabular text-emerald-700">{money(r.paid, symbol)}</span> },
                { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => <span className="tabular text-amber-700">{money(r.outstanding, symbol)}</span> },
                { key: 'tax', label: 'Tax', align: 'right', render: (r) => <span className="tabular text-ink-500">{money(r.tax, symbol)}</span> },
                { key: 'discounts', label: 'Discounts', align: 'right', render: (r) => <span className="tabular text-ink-500">{money(r.discounts, symbol)}</span> },
              ] : groupBy === 'customer' ? [
                { key: 'name', label: 'Customer', render: (r) => <div><div className="text-[13px] font-medium">{r.company_name || r.name}</div><div className="text-[11px] text-ink-400">{r.name}</div></div> },
                { key: 'invoices', label: 'Invoices', align: 'right' },
                { key: 'invoiced', label: 'Invoiced', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.invoiced, symbol)}</span> },
                { key: 'paid', label: 'Collected', align: 'right', render: (r) => <span className="tabular text-emerald-700">{money(r.paid, symbol)}</span> },
                { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => <span className={`tabular ${r.outstanding > 0 ? 'text-amber-700 font-medium' : 'text-ink-400'}`}>{money(r.outstanding, symbol)}</span> },
              ] : groupBy === 'plan' ? [
                { key: 'name', label: 'Plan' },
                { key: 'billing_period', label: 'Cadence', render: (r) => <Badge>{r.billing_period}</Badge> },
                { key: 'invoices', label: 'Invoices', align: 'right' },
                { key: 'invoiced', label: 'Invoiced', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.invoiced, symbol)}</span> },
                { key: 'paid', label: 'Collected', align: 'right', render: (r) => <span className="tabular text-emerald-700">{money(r.paid, symbol)}</span> },
              ] : [
                { key: 'method', label: 'Method', render: (r) => titleise(r.method) },
                { key: 'c', label: 'Payments', align: 'right' },
                { key: 'amount', label: 'Collected', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.amount, symbol)}</span> },
              ]}
              rows={revenue?.rows || []}
              empty={<EmptyState icon="chart" title="No revenue in this range" description="Widen the dates or run a billing sweep to generate invoices." />}
            />
          </Card>
        </div>
      )}

      {/* ---------------- RECEIVABLES ---------------- */}
      {tab === 'receivables' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5 lg:col-span-2">
              <h3 className="text-[14px] font-semibold text-ink-900">Ageing buckets</h3>
              <p className="text-[12px] text-ink-500 mt-0.5 mb-4">How long the outstanding money has been overdue</p>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ageingFrom(dashboard?.aging)} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eceef6" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false} tickFormatter={(v) => moneyShort(v, symbol)} width={66} />
                    <Tooltip content={<Tip symbol={symbol} />} />
                    <Bar isAnimationActive={false} dataKey="value" name="Outstanding" radius={[6, 6, 0, 0]} maxBarSize={64}>
                      {ageingFrom(dashboard?.aging).map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-[14px] font-semibold text-ink-900 mb-3">Summary</h3>
              <div className="space-y-3">
                <SumRow label="Total outstanding" value={money(receivables?.total || 0, symbol)} bold />
                {ageingFrom(dashboard?.aging).map((d) => (
                  <SumRow key={d.name} label={d.name} value={money(d.value, symbol)} dot={d.color} />
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-ink-100 space-y-2">
                <SumRow label="Overdue invoices" value={num(k?.overdue_count)} />
                <SumRow label="Average days late" value={avgDaysLate(receivables?.rows)} />
              </div>
              <button className="btn-secondary btn-sm w-full mt-4" onClick={() => navigate('/app/invoices?status=overdue')}>
                Chase overdue invoices
              </button>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-3">
              <h3 className="text-[14px] font-semibold text-ink-900">Open invoices</h3>
              <p className="text-[12px] text-ink-500 mt-0.5">Oldest first — the chase list</p>
            </div>
            <Table
              columns={[
                { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
                { key: 'customer', label: 'Customer', render: (r) => <div><div className="text-[13px]">{r.company_name || r.customer_name}</div><div className="text-[11px] text-ink-400">{r.email}</div></div> },
                { key: 'due_date', label: 'Due', render: (r) => <span className="text-[12.5px] text-ink-600">{date(r.due_date)}</span> },
                {
                  key: 'days_overdue', label: 'Days late', align: 'right',
                  render: (r) => <span className={`tabular ${r.days_overdue > 0 ? 'text-rose-600 font-medium' : 'text-ink-400'}`}>{r.days_overdue > 0 ? r.days_overdue : '—'}</span>,
                },
                { key: 'bucket', label: 'Bucket', render: (r) => <Badge tone={r.bucket === 'current' ? 'green' : r.bucket === '90+' ? 'red' : 'amber'}>{r.bucket}</Badge> },
                { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className="tabular font-semibold">{money(r.balance, symbol)}</span> },
                {
                  key: 'go', label: '', align: 'right',
                  render: (r) => <button className="btn-ghost btn-sm" onClick={() => navigate(`/app/invoices/${r.id}`)}>Open <Icon name="chevronRight" className="w-3 h-3" /></button>,
                },
              ]}
              rows={receivables?.rows || []}
              empty={<EmptyState icon="checkCircle" title="Nothing outstanding" description="Every confirmed invoice has been paid. Well done." />}
            />
          </Card>
        </div>
      )}

      {/* ---------------- SUBSCRIPTIONS ---------------- */}
      {tab === 'subscriptions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Active subscriptions" value={num(k?.active_subscriptions)} icon="checkCircle" tone="green" />
            <StatCard label="MRR" value={money(k?.mrr, symbol)} icon="trending" tone="brand" />
            <StatCard label="Churn rate" value={pct(k?.churn_rate)} icon="trending" tone="amber" />
            <StatCard label="Avg revenue / account" value={money(k?.avg_revenue_per_account, symbol)} icon="users" tone="violet" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="text-[14px] font-semibold text-ink-900">Active base by cadence</h3>
              <p className="text-[12px] text-ink-500 mt-0.5 mb-4">Normalised monthly value per billing period</p>
              <div className="h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie isAnimationActive={false} data={subsReport?.by_period || []} dataKey="mrr" nameKey="billing_period" innerRadius={54} outerRadius={84} paddingAngle={3} strokeWidth={0}>
                      {(subsReport?.by_period || []).map((d, i) => <Cell key={d.billing_period} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<Tip symbol={symbol} />} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(v) => titleise(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-[14px] font-semibold text-ink-900">MRR by cadence</h3>
              <p className="text-[12px] text-ink-500 mt-0.5 mb-4">Where recurring revenue comes from</p>
              <div className="space-y-3">
                {(subsReport?.by_period || []).map((p, i) => {
                  const max = Math.max(...(subsReport?.by_period || []).map((x) => x.mrr), 1);
                  return (
                    <div key={p.billing_period}>
                      <div className="flex items-center justify-between text-[12.5px] mb-1">
                        <span className="text-ink-600 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          {titleise(p.billing_period)} <span className="text-ink-400">· {p.c} subs</span>
                        </span>
                        <span className="tabular font-medium">{money(p.mrr, symbol)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(p.mrr / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                    </div>
                  );
                })}
                {!subsReport?.by_period?.length && <p className="text-[12.5px] text-ink-400">No active subscriptions.</p>}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-3">
              <h3 className="text-[14px] font-semibold text-ink-900">Expiring within 30 days</h3>
              <p className="text-[12px] text-ink-500 mt-0.5">Renew these before they lapse</p>
            </div>
            <Table
              columns={[
                { key: 'number', label: 'Subscription', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
                { key: 'customer_name', label: 'Customer' },
                { key: 'plan_name', label: 'Plan', render: (r) => <span className="text-[12.5px] text-ink-600">{r.plan_name}</span> },
                { key: 'expiry_date', label: 'Expires', render: (r) => <span className="text-[12.5px]">{date(r.expiry_date)}</span> },
                {
                  key: 'behaviour', label: 'At term end',
                  render: (r) => !r.allow_renew ? <Badge tone="amber">Closes</Badge>
                    : r.close_on_end ? <Badge tone="sky">Auto-renews, closes at max</Badge> : <Badge tone="green">Auto-renews</Badge>,
                },
                { key: 'go', label: '', align: 'right', render: (r) => <button className="btn-ghost btn-sm" onClick={() => navigate(`/app/subscriptions/${r.id}`)}>Open <Icon name="chevronRight" className="w-3 h-3" /></button> },
              ]}
              rows={subsReport?.expiring || []}
              empty={<EmptyState icon="calendar" title="Nothing expiring soon" description="No subscription ends in the next 30 days." />}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

const SumRow = ({ label, value, bold, dot }) => (
  <div className="flex items-center justify-between gap-3">
    <span className={`text-[12.5px] flex items-center gap-2 ${bold ? 'font-medium text-ink-900' : 'text-ink-600'}`}>
      {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
      {label}
    </span>
    <span className={`tabular ${bold ? 'text-[14px] font-semibold text-ink-900' : 'text-[12.5px] text-ink-800'}`}>{value}</span>
  </div>
);

function Tip({ active, payload, label, symbol = '₹' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-pop text-[12px]">
      {label && <div className="font-semibold text-ink-900 mb-1">{titleise(String(label))}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-600">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="capitalize">{p.name}</span>
          <span className="ml-auto font-medium text-ink-900 tabular">{money(p.value, symbol)}</span>
        </div>
      ))}
    </div>
  );
}

function ageingFrom(aging) {
  if (!aging) return [];
  return [
    { name: 'Current', value: aging.current, color: '#10b981' },
    { name: '1–30', value: aging.d1_30, color: '#f59e0b' },
    { name: '31–60', value: aging.d31_60, color: '#f97316' },
    { name: '61–90', value: aging.d61_90, color: '#ef4444' },
    { name: '90+', value: aging.d90_plus, color: '#991b1b' },
  ];
}

function avgDaysLate(rows) {
  const late = (rows || []).filter((r) => r.days_overdue > 0);
  if (!late.length) return '0 days';
  return `${Math.round(late.reduce((s, r) => s + r.days_overdue, 0) / late.length)} days`;
}
