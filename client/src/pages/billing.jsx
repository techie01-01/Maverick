import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Card, EmptyState, ErrorState, Icon, Input, Loading, SectionHeader, Spinner, StateBadge,
  StatCard, Table, Tabs, useToast,
} from '../components/ui.jsx';
import { date, dateTime, daysUntil, money, num, relative, today } from '../lib/format.js';

export default function BillingPage() {
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState('run');
  const [asOf, setAsOf] = useState(today());
  const [preview, setPreview] = useState(null);
  const [health, setHealth] = useState(null);
  const [runs, setRuns] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      get('/billing/preview', { as_of: asOf }),
      get('/billing/health'),
      get('/billing/runs', { limit: 20 }),
      get('/billing/upcoming', { days: 45 }),
    ]).then(([p, h, r, u]) => {
      setPreview(p); setHealth(h); setRuns(r); setUpcoming(u);
    }).catch(setError).finally(() => setLoading(false));
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  const runBilling = async () => {
    setRunning(true); setResult(null);
    try {
      const res = await post('/billing/run', { as_of: asOf });
      setResult(res);
      if (res.created > 0) {
        toast.success(`${res.created} invoice(s) created`, `${money(res.totalAmount, symbol)} billed in ${res.durationMs}ms`);
      } else {
        toast.info('Nothing to bill', 'Every subscription is already invoiced for this period.');
      }
      load();
    } catch (e) { toast.error(e.message); } finally { setRunning(false); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Recurring engine"
        title="Billing runs"
        description="Sweeps every active subscription that is due, raises the invoices and advances each one to its next period. The unique period index guarantees nothing is ever billed twice."
        actions={
          <button className="btn-secondary btn-sm" onClick={load}><Icon name="refresh" className="w-3.5 h-3.5" /> Refresh</button>
        }
      />

      {error ? <ErrorState error={error} onRetry={load} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Due now" value={num(preview?.count || 0)} sub={money(preview?.estimated_total || 0, symbol) + ' expected'} icon="zap" tone="brand" />
            <StatCard label="Awaiting catch-up" value={num(health?.stale_backlog || 0)} sub="Past their billing date" icon="clock" tone={health?.stale_backlog ? 'red' : 'ink'} />
            <StatCard label="Expiring in 30 days" value={num(health?.expiring_in_30_days || 0)} sub="Renew or close" icon="calendar" tone="amber" />
            <StatCard label="Last sweep" value={health?.last_run ? relative(health.last_run.started_at) : 'Never'}
              sub={health?.last_run ? `${health.last_run.invoices_created} invoices · ${health.last_run.trigger_source}` : 'Run one to get started'}
              icon="play" tone="green" />
          </div>

          {/* The action panel */}
          <Card className="p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="label">Billing date</label>
                <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-[170px]" />
              </div>
              <button className="btn-primary" onClick={runBilling} disabled={running}>
                {running ? <Spinner className="w-4 h-4" /> : <Icon name="play" className="w-4 h-4" />}
                {running ? 'Running sweep…' : 'Run billing sweep'}
              </button>
              <p className="text-[12px] text-ink-500 max-w-md leading-relaxed">
                Generates every invoice that falls due on or before this date, catching up on any missed
                periods. Draft invoices are created so the team can review before confirming.
              </p>
            </div>

            {result && (
              <div className={`mt-5 rounded-xl border p-4 ${result.created > 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-ink-200 bg-ink-50'}`}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
                    <Icon name={result.created > 0 ? 'checkCircle' : 'info'} className={`w-4 h-4 ${result.created > 0 ? 'text-emerald-600' : 'text-ink-400'}`} />
                    Sweep completed in {result.durationMs}ms
                  </div>
                  <Stat label="Subscriptions swept" value={num(result.swept)} />
                  <Stat label="Invoices created" value={num(result.created)} tone="green" />
                  <Stat label="Skipped" value={num(result.skipped)} />
                  <Stat label="Total billed" value={money(result.totalAmount, symbol)} />
                </div>

                {result.invoices?.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-2">Invoices raised by this run</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.invoices.slice(0, 24).map((i) => (
                        <button key={i.id} onClick={() => navigate(`/app/invoices/${i.id}`)}
                          className="chip bg-white text-ink-700 ring-ink-200 hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200 font-mono">
                          {i.number}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Tabs
            tabs={[
              { id: 'run', label: 'Due now', count: preview?.count },
              { id: 'upcoming', label: 'Upcoming schedule' },
              { id: 'history', label: 'Run history', count: runs?.total },
            ]}
            value={tab} onChange={setTab}
          />

          {tab === 'run' && (
            <Card className="overflow-hidden">
              {loading && !preview ? <Loading /> : (
                <Table
                  columns={[
                    { key: 'number', label: 'Subscription', render: (r) => (
                      <button className="font-mono text-[12.5px] font-semibold text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/app/subscriptions/${r.id}`); }}>
                        {r.number}
                      </button>
                    ) },
                    { key: 'customer', label: 'Customer', render: (r) => <span className="text-[13px] text-ink-700">{r.company_name || r.customer_name}</span> },
                    { key: 'plan_name', label: 'Plan', render: (r) => <span className="text-[12.5px] text-ink-600">{r.plan_name}</span> },
                    { key: 'next_billing_date', label: 'Period', render: (r) => (
                      r.term_ended
                        ? <span className="text-[12px] text-amber-700">Term ended {date(r.expiry_date)} — will {r.action}</span>
                        : <span className="text-[12px] text-ink-600">{date(r.next_billing_date)} → {date(r.period_end)}</span>
                    ) },
                    { key: 'estimated_amount', label: 'Est. amount', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.estimated_amount, symbol)}</span> },
                    { key: 'already_billed', label: '', align: 'right', render: (r) => r.already_billed > 0 ? <Badge tone="amber">Already billed</Badge> : null },
                  ]}
                  rows={preview?.rows || []}
                  empty={<EmptyState icon="checkCircle" title="Nothing is due" description="Every active subscription has already been billed up to this date. Come back tomorrow, or pick a later billing date." />}
                />
              )}
            </Card>
          )}

          {tab === 'upcoming' && (
            <Card className="overflow-hidden">
              {loading && !upcoming ? <Loading /> : (
                <Table
                  columns={[
                    { key: 'number', label: 'Subscription', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
                    { key: 'customer', label: 'Customer', render: (r) => <span className="text-[13px]">{r.company_name || r.customer_name}</span> },
                    { key: 'plan_name', label: 'Plan', render: (r) => <span className="text-[12.5px] text-ink-600">{r.plan_name}</span> },
                    {
                      key: 'next_billing_date', label: 'Next bill',
                      render: (r) => (
                        <div className="text-[12px]">
                          <div className="text-ink-700">{date(r.next_billing_date)}</div>
                          <div className="text-ink-400">{relative(r.next_billing_date)}</div>
                        </div>
                      ),
                    },
                    {
                      key: 'expiry_date', label: 'Term ends',
                      render: (r) => {
                        const d = daysUntil(r.expiry_date);
                        return (
                          <div className="text-[12px]">
                            <div className="text-ink-700">{date(r.expiry_date)}</div>
                            {d <= 30 && <div className={d < 0 ? 'text-rose-600' : 'text-amber-600'}>{d < 0 ? 'expired' : `${d}d left`}</div>}
                          </div>
                        );
                      },
                    },
                    { key: 'expected_amount', label: 'Expected', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.expected_amount, symbol)}</span> },
                    { key: 'state', label: 'Status', render: (r) => <StateBadge state={r.state} /> },
                  ]}
                  rows={upcoming?.rows || []}
                  empty={<EmptyState icon="calendar" title="Nothing scheduled" description="No subscriptions bill in the next 45 days." />}
                />
              )}
            </Card>
          )}

          {tab === 'history' && (
            <Card className="overflow-hidden">
              {loading && !runs ? <Loading /> : (
                <Table
                  columns={[
                    { key: 'started_at', label: 'Run', render: (r) => (
                      <div>
                        <div className="text-[13px] font-medium text-ink-900">{dateTime(r.started_at)}</div>
                        <div className="text-[11px] text-ink-400">as of {date(r.as_of_date)}</div>
                      </div>
                    ) },
                    { key: 'trigger_source', label: 'Trigger', render: (r) => <Badge tone={r.trigger_source === 'scheduler' ? 'sky' : 'brand'}>{r.trigger_source === 'scheduler' ? 'Scheduled' : 'Manual'}</Badge> },
                    { key: 'subscriptions_swept', label: 'Swept', align: 'right', render: (r) => <span className="tabular">{r.subscriptions_swept}</span> },
                    { key: 'invoices_created', label: 'Created', align: 'right', render: (r) => <span className={`tabular font-medium ${r.invoices_created > 0 ? 'text-emerald-700' : 'text-ink-400'}`}>{r.invoices_created}</span> },
                    { key: 'invoices_skipped', label: 'Skipped', align: 'right', render: (r) => <span className="tabular text-ink-500">{r.invoices_skipped}</span> },
                    { key: 'total_amount', label: 'Billed', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total_amount, symbol)}</span> },
                    { key: 'duration_ms', label: 'Duration', align: 'right', render: (r) => <span className="tabular text-ink-500">{r.duration_ms}ms</span> },
                    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'completed' ? 'green' : 'amber'}>{r.status}</Badge> },
                  ]}
                  rows={runs?.rows || []}
                  empty={<EmptyState icon="zap" title="No billing runs yet" description="Press “Run billing sweep” to create this period's invoices." />}
                />
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const Stat = ({ label, value, tone }) => (
  <div>
    <div className="text-[10.5px] uppercase tracking-wider text-ink-400">{label}</div>
    <div className={`text-[13.5px] font-semibold tabular ${tone === 'green' ? 'text-emerald-700' : 'text-ink-900'}`}>{value}</div>
  </div>
);
