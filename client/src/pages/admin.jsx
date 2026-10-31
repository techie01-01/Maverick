import { useCallback, useEffect, useState } from 'react';
import { get, post, patch, put } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PasswordRules } from './auth.jsx';
import {
  Avatar, Badge, Card, DetailRow, EmptyState, ErrorState, Field, Icon, Input, Loading, Modal,
  Pagination, SectionHeader, Select, Spinner, StatCard, Switch, Table, Tabs, Textarea, useToast,
} from '../components/ui.jsx';
import { date, dateTime, num, titleise } from '../lib/format.js';

/* ==================================================================== */
/* TEAM & ACCESS (admin only)                                            */
/* ==================================================================== */
export function TeamPage() {
  const { user: me, isAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('staff');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);

  const role = tab === 'staff' ? 'staff' : tab === 'customers' ? 'customer' : 'admin';

  const load = useCallback(() => {
    setError(null); setData(null);
    get('/users', { role, q, page, limit: 20 }).then(setData).catch(setError);
  }, [role, q, page]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const toggle = async (u) => {
    try { await patch(`/users/${u.id}`, { is_active: u.is_active ? 0 : 1 }); toast.success(u.is_active ? 'Account deactivated' : 'Account reactivated'); load(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Administration"
        title="Team & access"
        description="Not everyone who logs in should see the same things. The admin controls the whole system, staff handle day-to-day work with limited access, customers only ever see their own records."
        actions={isAdmin ? <button className="btn-primary btn-sm" onClick={() => setInviteOpen(true)}><Icon name="plus" className="w-3.5 h-3.5" /> Add staff member</button> : null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          ['admin', 'Full control', 'Plans, taxes, discounts, staff, settings — everything.', 'shield', 'brand'],
          ['staff', 'Day-to-day', 'Create subscriptions and invoices, record payments. Cannot change pricing or staff.', 'user', 'sky'],
          ['customer', 'Portal only', 'Sees their own subscriptions and invoices, and can request plans.', 'building', 'green'],
        ].map(([role, title, desc, icon, tone]) => (
          <Card key={role} className="p-4">
            <div className="flex items-center gap-2.5">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${tone}-50 text-${tone}-600`}
                style={{ background: tone === 'brand' ? '#eef2ff' : tone === 'sky' ? '#f0f9ff' : '#ecfdf5', color: tone === 'brand' ? '#4f46e5' : tone === 'sky' ? '#0284c7' : '#059669' }}>
                <Icon name={icon} className="w-4 h-4" />
              </span>
              <div>
                <div className="text-[13.5px] font-semibold text-ink-900 capitalize">{role}</div>
                <div className="text-[11.5px] text-ink-500">{title}</div>
              </div>
            </div>
            <p className="text-[12px] text-ink-500 mt-2.5 leading-relaxed">{desc}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-100">
          <Tabs tabs={[{ id: 'staff', label: 'Staff' }, { id: 'admins', label: 'Administrators' }, { id: 'customers', label: 'Customers' }]}
            value={tab} onChange={(v) => { setTab(v); setPage(1); }} />
          <div className="relative ml-auto min-w-[200px]">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="pl-9 h-9" />
          </div>
        </div>

        {error ? <ErrorState error={error} onRetry={load} /> : !data ? <Loading /> : (
          <>
            <Table
              columns={[
                {
                  key: 'name', label: 'Member',
                  render: (r) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.name} size="sm" />
                      <div>
                        <div className="text-[13px] font-medium text-ink-900">{r.name} {r.id === me.id && <span className="text-[10px] text-brand-600 font-semibold">(you)</span>}</div>
                        <div className="text-[11.5px] text-ink-400">{r.email}</div>
                      </div>
                    </div>
                  ),
                },
                { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'admin' ? 'brand' : r.role === 'staff' ? 'sky' : 'green'}>{titleise(r.role)}</Badge> },
                { key: 'active_subs', label: 'Active subs', align: 'right', render: (r) => r.role === 'customer' ? <span className="tabular">{r.active_subs ?? 0}</span> : <span className="text-ink-300">—</span> },
                { key: 'last_login_at', label: 'Last login', render: (r) => <span className="text-[12px] text-ink-500">{r.last_login_at ? dateTime(r.last_login_at) : 'Never'}</span> },
                { key: 'created_at', label: 'Joined', render: (r) => <span className="text-[12px] text-ink-500">{date(r.created_at)}</span> },
                {
                  key: 'status', label: 'Status',
                  render: (r) => r.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="ink">Inactive</Badge>,
                },
                {
                  key: 'actions', label: '', align: 'right',
                  render: (r) => isAdmin && r.id !== me.id ? (
                    <button className="btn-ghost btn-sm" onClick={() => toggle(r)}>
                      {r.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  ) : null,
                },
              ]}
              rows={data.rows}
              empty={<EmptyState icon="users" title="Nobody here" description="Add a staff member to give someone day-to-day access." />}
            />
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={setPage} />
          </>
        )}
      </Card>

      <InviteStaffModal open={inviteOpen} onClose={() => setInviteOpen(false)} onSaved={load} />
    </div>
  );
}

function InviteStaffModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');

  useEffect(() => { if (open) { setForm({ name: '', email: '', phone: '', password: '' }); setError(''); setFieldError(''); } }, [open]);

  const submit = async () => {
    setBusy(true); setError(''); setFieldError('');
    try {
      await post('/users/staff', form);
      toast.success('Staff member added', `${form.email} can sign in with the password you set`);
      onSaved(); onClose();
    } catch (e) {
      setError(e.message);
      if (e.details?.password) setFieldError(e.details.password.join(' '));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a staff member"
      description="Only the administrator can do this. Staff get day-to-day access with limited permissions."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.name || !form.email || !form.password}>
          {busy && <Spinner className="w-4 h-4" />} Create account
        </button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya Raghavan" /></Field>
        <Field label="Work email" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="priya@brightloop.io" /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98400 00000" /></Field>
        <Field label="Initial password" required error={fieldError}>
          <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Set a temporary password" />
          <PasswordRules password={form.password} />
        </Field>
        <p className="text-[11.5px] text-ink-400 flex items-start gap-1.5">
          <Icon name="info" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Share the password securely — they can change it from their profile once signed in.
        </p>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* SETTINGS                                                              */
/* ==================================================================== */
export function SettingsPage() {
  const { settings, user, isAdmin, refresh, setSettings, isCustomer } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState(isAdmin ? 'company' : 'profile');
  const [form, setForm] = useState({});
  const [profile, setProfile] = useState({ name: '', phone: '', address: '', city: '', country: '', company_name: '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(settings || {});
    if (user) setProfile({ name: user.name, phone: user.phone || '', address: user.address || '', city: user.city || '', country: user.country || '', company_name: user.company_name || '' });
  }, [settings, user]);

  const saveCompany = async () => {
    setBusy('company');
    try {
      const res = await put('/settings', form);
      setSettings(res.settings);
      toast.success('Settings saved');
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const saveProfile = async () => {
    setBusy('profile');
    try { await patch(`/users/${user.id}`, profile); await refresh(); toast.success('Profile updated'); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const changePassword = async () => {
    setError('');
    if (pw.new_password !== pw.confirm) { setError('Passwords do not match.'); return; }
    setBusy('password');
    try {
      await post('/auth/change-password', { current_password: pw.current_password, new_password: pw.new_password });
      toast.success('Password changed');
      setPw({ current_password: '', new_password: '', confirm: '' });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  if (!user) return <Loading />;

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">
      <SectionHeader eyebrow="Administration" title="Settings"
        description="Company details used on invoices, document numbering, and your own profile and password." />

      <Tabs tabs={[
        ...(isAdmin ? [{ id: 'company', label: 'Company & invoicing' }] : []),
        { id: 'profile', label: 'My profile' },
        { id: 'security', label: 'Password & security' },
      ]} value={tab} onChange={setTab} />

      {tab === 'company' && isAdmin && (
        <Card className="p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name"><Input value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label="Billing email"><Input value={form.company_email || ''} onChange={(e) => setForm({ ...form, company_email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.company_phone || ''} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} /></Field>
            <Field label="GSTIN / Tax ID"><Input value={form.company_tax_id || ''} onChange={(e) => setForm({ ...form, company_tax_id: e.target.value })} /></Field>
          </div>
          <Field label="Registered address"><Textarea rows={2} value={form.company_address || ''} onChange={(e) => setForm({ ...form, company_address: e.target.value })} /></Field>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Currency code"><Input value={form.currency || ''} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field>
            <Field label="Currency symbol"><Input value={form.currency_symbol || ''} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} /></Field>
            <Field label="Invoice prefix"><Input value={form.invoice_prefix || ''} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} /></Field>
            <Field label="Subscription prefix"><Input value={form.subscription_prefix || ''} onChange={(e) => setForm({ ...form, subscription_prefix: e.target.value })} /></Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default payment terms">
              <Select value={form.default_payment_term || 'net30'} onChange={(e) => setForm({ ...form, default_payment_term: e.target.value })}>
                {['immediate', 'net7', 'net15', 'net30', 'net45', 'net60'].map((t) => <option key={t} value={t}>{t === 'immediate' ? 'Due on receipt' : titleise(t)}</option>)}
              </Select>
            </Field>
            <Field label="Default tax rate %"><Input type="number" step="0.1" value={form.default_tax_rate || ''} onChange={(e) => setForm({ ...form, default_tax_rate: e.target.value })} /></Field>
          </div>

          <Switch checked={form.scheduler_enabled === '1'} onChange={(v) => setForm({ ...form, scheduler_enabled: v ? '1' : '0' })}
            label="Run the daily billing scheduler" description="While the server is up, due subscriptions are invoiced once a day without anyone pressing a button." />

          <div className="flex justify-end pt-2">
            <button className="btn-primary" onClick={saveCompany} disabled={busy === 'company'}>
              {busy === 'company' && <Spinner className="w-4 h-4" />} Save settings
            </button>
          </div>
        </Card>
      )}

      {tab === 'profile' && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <Avatar name={user.name} size="lg" />
            <div>
              <div className="text-[15px] font-semibold text-ink-900">{user.name}</div>
              <div className="text-[12.5px] text-ink-500">{user.email} · <span className="capitalize">{user.role}</span></div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label="Company"><Input value={profile.company_name} onChange={(e) => setProfile({ ...profile, company_name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
            <Field label="City"><Input value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} /></Field>
          </div>
          <Field label="Address"><Textarea rows={2} value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></Field>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={saveProfile} disabled={busy === 'profile'}>
              {busy === 'profile' && <Spinner className="w-4 h-4" />} Save profile
            </button>
          </div>
        </Card>
      )}

      {tab === 'security' && (
        <Card className="p-5 space-y-4 max-w-lg">
          <h3 className="text-[14px] font-semibold text-ink-900">Change password</h3>
          {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
          <Field label="Current password" required>
            <Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </Field>
          <Field label="New password" required>
            <Input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            <PasswordRules password={pw.new_password} />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          <button className="btn-primary w-full" onClick={changePassword} disabled={busy === 'password' || !pw.current_password || !pw.new_password}>
            {busy === 'password' && <Spinner className="w-4 h-4" />} Update password
          </button>
        </Card>
      )}
    </div>
  );
}

/* ==================================================================== */
/* EMAIL LOG                                                             */
/* ==================================================================== */
export function MailPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setError(null);
    get('/mail', { page, limit: 25, category }).then(setData).catch(setError);
  }, [page, category]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader eyebrow="Operations" title="Email log"
        description="Every message the platform sends — invoices, receipts, password resets and alerts. In development the messages are captured here instead of leaving through SMTP." />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
          <Tabs tabs={[{ id: '', label: 'All' }, { id: 'invoice', label: 'Invoices' }, { id: 'payment_receipt', label: 'Receipts' }, { id: 'password_reset', label: 'Password resets' }, { id: 'welcome', label: 'Welcome' }]}
            value={category} onChange={(v) => { setCategory(v); setPage(1); }} />
        </div>
        {error ? <ErrorState error={error} onRetry={load} /> : !data ? <Loading /> : (
          <>
            <Table
              columns={[
                { key: 'to_email', label: 'To', render: (r) => <span className="text-[12.5px] text-ink-800">{r.to_email}</span> },
                { key: 'subject', label: 'Subject', render: (r) => <span className="text-[12.5px] text-ink-900 font-medium">{r.subject}</span> },
                { key: 'category', label: 'Type', render: (r) => <Badge tone={r.category === 'invoice' ? 'brand' : r.category === 'payment_receipt' ? 'green' : 'ink'}>{titleise(r.category)}</Badge> },
                { key: 'created_at', label: 'Sent', render: (r) => <span className="text-[12px] text-ink-500">{dateTime(r.created_at)}</span> },
                { key: 'go', label: '', align: 'right', render: (r) => <button className="btn-ghost btn-sm" onClick={() => setSelected(r)}>Read</button> },
              ]}
              rows={data.rows}
              empty={<EmptyState icon="mail" title="No messages" description="Emails sent by the platform will be captured here." />}
            />
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.subject || ''}
        description={selected ? `To ${selected.to_email} · ${dateTime(selected.created_at)}` : ''} size="md">
        <pre className="whitespace-pre-wrap text-[13px] text-ink-700 leading-relaxed font-sans">{selected?.body}</pre>
      </Modal>
    </div>
  );
}

/* ==================================================================== */
/* ACTIVITY (small utility panel used by Settings)                       */
/* ==================================================================== */
export function ActivityPage() {
  const [data, setData] = useState(null);
  useEffect(() => { get('/activity', { limit: 50 }).then(setData).catch(() => {}); }, []);
  if (!data) return <Loading />;
  return (
    <Card className="overflow-hidden">
      <Table
        columns={[
          { key: 'created_at', label: 'When', render: (r) => <span className="text-[12px] text-ink-500">{dateTime(r.created_at)}</span> },
          { key: 'actor', label: 'Who', render: (r) => <span className="text-[12.5px]">{r.actor}</span> },
          { key: 'action', label: 'Action', render: (r) => <Badge>{r.action}</Badge> },
          { key: 'summary', label: 'What happened', render: (r) => <span className="text-[12.5px] text-ink-700">{r.summary}</span> },
        ]}
        rows={data.rows}
      />
    </Card>
  );
}
