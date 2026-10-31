import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { get } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Avatar, Badge, Card, ErrorState, Icon, SectionHeader, Skeleton, StatCard, StateBadge, Table,
} from '../components/ui.jsx';
import { date, money, moneyShort, num, pct, relative, titleise } from '../lib/format.js';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#f43f5e'];

export default function DashboardPage() {
  const { settings } = useAuth();
  const navigate = useNavigate();
  const symbol = settings?.currency_symbol || '₹';
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      get('/reports/dashboard'),
      get('/billing/health').catch(() => null),
    ])
      .then(([d, h]) => { setData(d); setHealth(h); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (loading || !data) {
    return (
      <div className="space-y-5">
        <div className="h-10 w-64 bg-ink-200/60 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rows={2} />)}
        </div>
        <Skeleton rows={8} />
      </div>
    );
  }

  const k = data.kpis;

  return (
    <div className="space-y-6 animate-fade-in">
      <SectionHeader
        eyebrow="This month at a glance"
        title="Revenue dashboard"
        description={`Live position as of ${date(data.as_of)} — everything the finance lead needs without waiting for a quarter to close.`}
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={load}>
              <Icon name="refresh" className="w-3.5 h-3.5" /> Refresh
            </button>
            <Link to="/app/reports" className="btn-primary btn-sm">
              <Icon name="chart" className="w-3.5 h-3.5" /> Open reports
            </Link>
          </>
        }
      />

      {/* Alerts */}
      {(health?.stale_backlog > 0 || k.overdue_count > 0 || k.draft_invoices > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {k.overdue_count > 0 && (
            <AlertCard tone="red" icon="alert"
              title={`${k.overdue_count} overdue invoice${k.overdue_count > 1 ? 's' : ''}`}
              body={`${money(k.overdue_amount, symbol)} past its due date — chase before it becomes bad debt.`}
              action={{ label: 'View overdue', to: '/app/invoices?status=overdue' }} />
          )}
          {k.draft_invoices > 0 && (
            <AlertCard tone="amber" icon="receipt"
              title={`${k.draft_invoices} draft invoice${k.draft_invoices > 1 ? 's' : ''}`}
              body="Generated but not yet confirmed. Confirm them so customers can pay."
              action={{ label: 'Review drafts', to: '/app/invoices?state=draft' }} />
          )}
          {health?.stale_backlog > 0 && (
            <AlertCard tone="sky" icon="zap"
              title={`${health.stale_backlog} subscription${health.stale_backlog > 1 ? 's' : ''} awaiting billing`}
              body="Past their next billing date. Run the billing sweep to catch up."
              action={{ label: 'Run billing', to: '/app/billing' }} />
          )}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Monthly recurring revenue" value={moneyShort(k.mrr, symbol)}
          sub={`ARR ${moneyShort(k.arr, symbol)} · ${num(k.active_subscriptions)} active`}
          icon="trending" tone="brand" onClick={() => navigate('/app/reports')} />
        <StatCard label="Collected this month" value={moneyShort(k.collected_this_month, symbol)}
          sub={`${num(k.payments_this_month)} payments`} icon="wallet" tone="green"
          trend={k.collected_change_pct} onClick={() => navigate('/app/payments')} />
        <StatCard label="Outstanding" value={moneyShort(k.outstanding, symbol)}
          sub={`${num(k.open_invoices)} open invoices`} icon="clock" tone="amber"
          onClick={() => navigate('/app/invoices?status=outstanding')} />
        <StatCard label="Overdue" value={moneyShort(k.overdue_amount, symbol)}
          sub={`${num(k.overdue_count)} invoices past due`} icon="alert" tone="red"
          onClick={() => navigate('/app/invoices?status=overdue')} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-[14px] font-semibold text-ink-900">Invoiced vs collected</h3>
              <p className="text-[12px] text-ink-500 mt-0.5">Rolling 12 months</p>
            </div>
            <div className="flex items-center gap-3 text-[11.5px] text-ink-500">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand-500" /> Invoiced</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Collected</span>
            </div>
          </div>
          <div className="h-[264px] mt-4 -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gCol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceef6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => moneyShort(v, symbol)} width={64} />
                <Tooltip content={<ChartTip symbol={symbol} />} />
                <Area isAnimationActive={false} type="monotone" dataKey="invoiced" stroke="#4f46e5" strokeWidth={2} fill="url(#gInv)" name="Invoiced" />
                <Area isAnimationActive={false} type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} fill="url(#gCol)" name="Collected" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink-900">Receivables ageing</h3>
          <p className="text-[12px] text-ink-500 mt-0.5">Where the outstanding money sits</p>
          <div className="h-[190px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie isAnimationActive={false} data={ageingData(data.aging)} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                  {ageingData(data.aging).map((d, i) => <Cell key={d.name} fill={d.color || COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<ChartTip symbol={symbol} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1.5">
            {ageingData(data.aging).map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-[12px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="text-ink-500 flex-1">{d.name}</span>
                <span className="tabular font-medium text-ink-800">{moneyShort(d.value, symbol)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Subscription movement */}
        <Card className="p-5 self-start">
          <h3 className="text-[14px] font-semibold text-ink-900 mb-3">Subscription base</h3>
          <div className="space-y-2.5">
            {[
              ['active', data.states.active || 0, 'emerald'],
              ['quotation', (data.states.quotation || 0) + (data.states.confirmed || 0), 'amber'],
              ['paused', data.states.paused || 0, 'violet'],
              ['draft', data.states.draft || 0, 'ink'],
              ['closed', data.states.closed || 0, 'ink'],
            ].map(([state, count, tone]) => {
              const total = Math.max(k.total_subscriptions, 1);
              return (
                <div key={state}>
                  <div className="flex items-center justify-between text-[12.5px] mb-1">
                    <span className="text-ink-600 capitalize">{state === 'quotation' ? 'quotation / confirmed' : state}</span>
                    <span className="font-semibold text-ink-900 tabular">{num(count)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                    <div className={`h-full rounded-full bg-${tone === 'ink' ? 'ink-400' : `${tone}-500`}`}
                      style={{ width: `${(count / total) * 100}%`, background: tone === 'emerald' ? '#10b981' : tone === 'amber' ? '#f59e0b' : tone === 'violet' ? '#8b5cf6' : '#b1b8d1' }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-ink-100 grid grid-cols-2 gap-3">
            <MiniStat label="New this month" value={num(k.new_subscriptions_this_month)} icon="plus" tone="green" />
            <MiniStat label="Closed this month" value={num(k.closed_this_month)} icon="close" tone="red" />
            <MiniStat label="Churn rate" value={pct(k.churn_rate)} icon="trending" tone="amber" />
            <MiniStat label="Avg / account" value={moneyShort(k.avg_revenue_per_account, symbol)} icon="users" tone="brand" />
          </div>
        </Card>

        {/* Top customers */}
        <Card className="xl:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div>
              <h3 className="text-[14px] font-semibold text-ink-900">Top customers by billing</h3>
              <p className="text-[12px] text-ink-500 mt-0.5">Lifetime invoiced, with what is still owed</p>
            </div>
            <Link to="/app/customers" className="text-[12.5px] link">All customers</Link>
          </div>
          <Table
            dense
            columns={[
              {
                key: 'name', label: 'Customer',
                render: (r) => (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.company_name || r.name} size="sm" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink-900 truncate">{r.company_name || r.name}</div>
                      <div className="text-[11px] text-ink-400 truncate">{r.name}</div>
                    </div>
                  </div>
                ),
              },
              { key: 'active_subs', label: 'Active', align: 'right', render: (r) => <span className="tabular">{r.active_subs}</span> },
              { key: 'billed', label: 'Invoiced', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.billed, symbol)}</span> },
              {
                key: 'owed', label: 'Owed', align: 'right',
                render: (r) => <span className={`tabular ${r.owed > 0 ? 'text-rose-600 font-medium' : 'text-ink-400'}`}>{r.owed > 0 ? money(r.owed, symbol) : '—'}</span>,
              },
            ]}
            rows={data.top_customers}
            onRowClick={(r) => navigate(`/app/customers/${r.id}`)}
            empty={<div className="px-5 py-10 text-center text-[13px] text-ink-400">No billing history yet.</div>}
          />
        </Card>
      </div>

      {/* Plan & method mix */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink-900">Revenue by plan</h3>
          <p className="text-[12px] text-ink-500 mt-0.5 mb-4">Active subscriptions and their monthly contribution</p>
          <div className="h-[220px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.plan_mix} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceef6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8791b4' }} axisLine={false} tickLine={false}
                  interval={0} angle={-12} textAnchor="end" height={52} />
                <YAxis tick={{ fontSize: 11, fill: '#8791b4' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => moneyShort(v, symbol)} width={70} />
                <Tooltip content={<ChartTip symbol={symbol} />} />
                <Bar isAnimationActive={false} dataKey="mrr" name="MRR" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink-900">How customers pay</h3>
          <p className="text-[12px] text-ink-500 mt-0.5 mb-4">All payments recorded to date</p>
          <div className="space-y-3">
            {data.method_mix.length === 0 && <p className="text-[13px] text-ink-400 py-6 text-center">No payments recorded yet.</p>}
            {data.method_mix.map((m, i) => {
              const max = Math.max(...data.method_mix.map((x) => x.amount), 1);
              return (
                <div key={m.method}>
                  <div className="flex items-center justify-between text-[12.5px] mb-1">
                    <span className="text-ink-600 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      {titleise(m.method)}
                    </span>
                    <span className="tabular font-medium text-ink-900">{money(m.amount, symbol)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(m.amount / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Recent invoices */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-[14px] font-semibold text-ink-900">Latest invoices</h3>
          <Link to="/app/invoices" className="text-[12.5px] link">View all</Link>
        </div>
        <RecentInvoices symbol={symbol} />
      </Card>
    </div>
  );
}

function RecentInvoices({ symbol }) {
  const [rows, setRows] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    get('/invoices', { limit: 8, sort: 'invoice_date', dir: 'desc' }).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, []);
  if (!rows) return <Skeleton rows={4} />;
  return (
    <Table
      dense
      columns={[
        { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-[12.5px] font-medium text-ink-900">{r.number}</span> },
        {
          key: 'customer', label: 'Customer',
          render: (r) => <span className="text-[13px] text-ink-700">{r.company_name || r.customer_name}</span>,
        },
        { key: 'invoice_date', label: 'Issued', render: (r) => <span className="text-[12.5px] text-ink-500">{date(r.invoice_date)}</span> },
        { key: 'due_date', label: 'Due', render: (r) => <span className="text-[12.5px] text-ink-500">{date(r.due_date)}</span> },
        {
          key: 'state', label: 'Status',
          render: (r) => r.is_overdue ? <Badge tone="red">Overdue</Badge> : <StateBadge state={r.state} />,
        },
        { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total, symbol)}</span> },
        {
          key: 'balance', label: 'Balance', align: 'right',
          render: (r) => <span className={`tabular ${r.balance > 0 ? 'text-amber-700 font-medium' : 'text-ink-400'}`}>{money(r.balance, symbol)}</span>,
        },
      ]}
      rows={rows}
      onRowClick={(r) => navigate(`/app/invoices/${r.id}`)}
    />
  );
}

function AlertCard({ tone, icon, title, body, action }) {
  const tones = {
    red: 'border-rose-200 bg-rose-50/70 text-rose-600',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-600',
    sky: 'border-sky-200 bg-sky-50/70 text-sky-600',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0"><Icon name={icon} className="w-4 h-4" /></div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">{title}</div>
          <p className="text-[12px] text-ink-600 mt-0.5 leading-snug">{body}</p>
          <Link to={action.to} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-ink-800 hover:underline">
            {action.label} <Icon name="chevronRight" className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon, tone }) {
  const tones = { green: 'text-emerald-600 bg-emerald-50', red: 'text-rose-600 bg-rose-50', amber: 'text-amber-600 bg-amber-50', brand: 'text-brand-600 bg-brand-50' };
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <Icon name={icon} className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink-900 tabular leading-tight">{value}</div>
        <div className="text-[10.5px] text-ink-400 truncate">{label}</div>
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, symbol = '₹' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-pop text-[12px]">
      {label && <div className="font-semibold text-ink-900 mb-1">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-600">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span>{p.name}</span>
          <span className="ml-auto font-medium text-ink-900 tabular">{money(p.value, symbol)}</span>
        </div>
      ))}
    </div>
  );
}

function ageingData(aging) {
  return [
    { name: 'Current', value: aging.current, color: '#10b981' },
    { name: '1–30 days', value: aging.d1_30, color: '#f59e0b' },
    { name: '31–60 days', value: aging.d31_60, color: '#f97316' },
    { name: '61–90 days', value: aging.d61_90, color: '#ef4444' },
    { name: '90+ days', value: aging.d90_plus, color: '#991b1b' },
  ].filter((d) => d.value > 0);
}
