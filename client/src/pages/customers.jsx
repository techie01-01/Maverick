import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, patch } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Avatar, Badge, Card, DetailRow, EmptyState, ErrorState, Field, Icon, Input, Loading, Menu,
  Pagination, SectionHeader, Spinner, StateBadge, StatCard, Table, Tabs, useToast,
} from '../components/ui.jsx';
import { CreateSubscriptionModal } from './subscriptions.jsx';
import { date, money, num, titleise } from '../lib/format.js';

export function CustomersPage() {
  const { settings, isAdmin } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [newSubFor, setNewSubFor] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    get('/users', { role: 'customer', q, page, limit: 20 }).then(setData).catch(setError).finally(() => setLoading(false));
  }, [q, page]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const toggleActive = async (u) => {
    try { await patch(`/users/${u.id}`, { is_active: u.is_active ? 0 : 1 }); toast.success(u.is_active ? 'Customer deactivated' : 'Customer reactivated'); load(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Relationships"
        title="Customers"
        description="Everyone who buys from Brightloop, with their active subscriptions, lifetime billing and anything still owed."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-100">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, company or email…" className="pl-9 h-9" />
          </div>
          <span className="text-[12.5px] text-ink-500">{num(data?.total || 0)} customers</span>
        </div>

        {error ? <ErrorState error={error} onRetry={load} /> : loading && !data ? <Loading /> : (
          <>
            <Table
              columns={[
                {
                  key: 'name', label: 'Customer',
                  render: (r) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.company_name || r.name} size="sm" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink-900 truncate">{r.company_name || r.name}</div>
                        <div className="text-[11.5px] text-ink-400 truncate">{r.email}</div>
                      </div>
                    </div>
                  ),
                },
                { key: 'active_subs', label: 'Active subs', align: 'right', render: (r) => <span className="tabular font-medium">{r.active_subs}</span> },
                { key: 'lifetime_invoiced', label: 'Lifetime billed', align: 'right', render: (r) => <span className="tabular">{money(r.lifetime_invoiced, symbol)}</span> },
                {
                  key: 'outstanding', label: 'Owed', align: 'right',
                  render: (r) => <span className={`tabular ${r.outstanding > 0 ? 'text-rose-600 font-medium' : 'text-ink-300'}`}>{r.outstanding > 0 ? money(r.outstanding, symbol) : '—'}</span>,
                },
                { key: 'city', label: 'Location', render: (r) => <span className="text-[12.5px] text-ink-500">{r.city || '—'}</span> },
                {
                  key: 'status', label: 'Status',
                  render: (r) => r.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="ink">Inactive</Badge>,
                },
                {
                  key: 'actions', label: '', align: 'right',
                  render: (r) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu align="right" trigger={<button className="btn-ghost btn-sm"><Icon name="settings" className="w-4 h-4" /></button>}
                        items={[
                          { label: 'Open profile', icon: 'user', onClick: () => navigate(`/app/customers/${r.id}`) },
                          { label: 'New subscription', icon: 'plus', onClick: () => setNewSubFor(r.id) },
                          ...(isAdmin ? [{ divider: true }, { label: r.is_active ? 'Deactivate' : 'Reactivate', icon: 'shield', danger: r.is_active, onClick: () => toggleActive(r) }] : []),
                        ]} />
                    </div>
                  ),
                },
              ]}
              rows={data?.rows || []}
              onRowClick={(r) => navigate(`/app/customers/${r.id}`)}
              empty={<EmptyState icon="users" title="No customers yet" description="Customers appear here as soon as they sign up." />}
            />
            <Pagination page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} limit={data?.limit || 20} onPage={setPage} />
          </>
        )}
      </Card>

      <CreateSubscriptionModal open={!!newSubFor} onClose={() => setNewSubFor(null)} presetCustomer={newSubFor}
        onCreated={(row) => navigate(`/app/subscriptions/${row.id}`)} />
    </div>
  );
}

/* ==================================================================== */
/* CUSTOMER PROFILE                                                      */
/* ==================================================================== */
export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, canManage } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [data, setData] = useState(null);
  const [subs, setSubs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('subscriptions');
  const [newSub, setNewSub] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      get(`/users/${id}`),
      get('/subscriptions', { customer_id: id, limit: 50 }),
      get('/invoices', { customer_id: id, limit: 50 }),
    ]).then(([u, s, i]) => {
      setData(u); setSubs(s.rows); setInvoices(i.rows);
      setForm({ name: u.user.name, company_name: u.user.company_name || '', phone: u.user.phone || '', address: u.user.address || '', city: u.user.city || '', country: u.user.country || '', tax_id: u.user.tax_id || '' });
    }).catch(setError);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try { await patch(`/users/${id}`, form); toast.success('Customer updated'); setEditing(false); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading />;

  const u = data.user;
  const s = data.stats;

  return (
    <div className="space-y-5 animate-fade-in">
      <button onClick={() => navigate(-1)} className="text-[12.5px] text-ink-500 hover:text-ink-900 flex items-center gap-1">
        <Icon name="chevronLeft" className="w-3.5 h-3.5" /> Back to customers
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={u.company_name || u.name} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight">{u.company_name || u.name}</h1>
              {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="ink">Inactive</Badge>}
            </div>
            <p className="text-[13px] text-ink-500 mt-0.5">{u.name} · {u.email}</p>
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(!editing)}><Icon name="edit" className="w-3.5 h-3.5" /> Edit</button>
            <button className="btn-primary btn-sm" onClick={() => setNewSub(true)}><Icon name="plus" className="w-3.5 h-3.5" /> New subscription</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active subscriptions" value={num(s.active_subscriptions)} sub={`${s.subscriptions} total`} icon="refresh" tone="green" />
        <StatCard label="Lifetime billed" value={money(invoices.reduce((a, i) => a + (i.state === 'cancelled' ? 0 : i.total), 0), symbol)} sub={`${s.invoices} invoices`} icon="receipt" tone="brand" />
        <StatCard label="Total paid" value={money(s.paid, symbol)} icon="wallet" tone="sky" />
        <StatCard label="Outstanding" value={money(s.outstanding, symbol)} icon="clock" tone={s.outstanding > 0 ? 'red' : 'ink'} />
      </div>

      {editing && (
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold mb-3">Edit customer details</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Contact name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Company"><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="GSTIN / Tax ID"><Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner className="w-3.5 h-3.5" />} Save</button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
        <div className="space-y-4">
          <Tabs tabs={[
            { id: 'subscriptions', label: 'Subscriptions', count: subs.length },
            { id: 'invoices', label: 'Invoices', count: invoices.length },
          ]} value={tab} onChange={setTab} />

          {tab === 'subscriptions' && (
            <Card className="overflow-hidden">
              <Table
                columns={[
                  { key: 'number', label: 'Subscription', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
                  { key: 'plan_name', label: 'Plan', render: (r) => <div><div className="text-[12.5px]">{r.plan_name}</div><div className="text-[11px] text-ink-400 capitalize">{r.billing_period}</div></div> },
                  { key: 'start_date', label: 'Term', render: (r) => <span className="text-[11.5px] text-ink-600">{date(r.start_date)} → {date(r.expiry_date)}</span> },
                  { key: 'state', label: 'Status', render: (r) => <StateBadge state={r.state} /> },
                  { key: 'mrr', label: 'MRR', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.mrr, symbol)}</span> },
                ]}
                rows={subs}
                onRowClick={(r) => navigate(`/app/subscriptions/${r.id}`)}
                empty={<EmptyState icon="refresh" title="No subscriptions" description="This customer has not subscribed to anything yet." />}
              />
            </Card>
          )}

          {tab === 'invoices' && (
            <Card className="overflow-hidden">
              <Table
                columns={[
                  { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-[12.5px] font-medium">{r.number}</span> },
                  { key: 'invoice_date', label: 'Issued', render: (r) => <span className="text-[12px] text-ink-600">{date(r.invoice_date)}</span> },
                  { key: 'due_date', label: 'Due', render: (r) => <span className="text-[12px] text-ink-600">{date(r.due_date)}</span> },
                  { key: 'state', label: 'Status', render: (r) => r.is_overdue ? <Badge tone="red">Overdue</Badge> : <StateBadge state={r.state} /> },
                  { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="tabular font-medium">{money(r.total, symbol)}</span> },
                  { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className={`tabular ${r.balance > 0 ? 'text-amber-700' : 'text-ink-300'}`}>{money(r.balance, symbol)}</span> },
                ]}
                rows={invoices}
                onRowClick={(r) => navigate(`/app/invoices/${r.id}`)}
                empty={<EmptyState icon="receipt" title="No invoices" description="Invoices appear here once a subscription is billed." />}
              />
            </Card>
          )}
        </div>

        <Card className="p-5">
          <h3 className="text-[14px] font-semibold mb-3">Profile</h3>
          <dl>
            <DetailRow label="Contact">{u.name}</DetailRow>
            <DetailRow label="Email">{u.email}</DetailRow>
            <DetailRow label="Phone">{u.phone || '—'}</DetailRow>
            <DetailRow label="Address">{u.address || '—'}</DetailRow>
            <DetailRow label="City">{u.city || '—'}</DetailRow>
            <DetailRow label="Country">{u.country || '—'}</DetailRow>
            <DetailRow label="GSTIN">{u.tax_id || '—'}</DetailRow>
            <DetailRow label="Customer since">{date(u.created_at)}</DetailRow>
            <DetailRow label="Last login">{u.last_login_at ? date(u.last_login_at) : 'Never'}</DetailRow>
          </dl>
          <Link to={`/app/invoices?q=${encodeURIComponent(u.email)}`} className="btn-secondary btn-sm w-full mt-4">
            <Icon name="receipt" className="w-3.5 h-3.5" /> View all invoices
          </Link>
        </Card>
      </div>

      <CreateSubscriptionModal open={newSub} onClose={() => setNewSub(false)} presetCustomer={Number(id)}
        onCreated={(row) => navigate(`/app/subscriptions/${row.id}`)} />
    </div>
  );
}
