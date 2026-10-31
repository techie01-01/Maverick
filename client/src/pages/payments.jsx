import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, del, downloadCsv } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Avatar, Badge, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Loading,
  Pagination, SectionHeader, Select, StatCard, Table, useToast, Modal,
} from '../components/ui.jsx';
import { date, money, num, titleise, today } from '../lib/format.js';

export default function PaymentsPage() {
  const { settings, isAdmin } = useAuth();
  const navigate = useNavigate();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [data, setData] = useState(null);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [reverse, setReverse] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => { get('/payments/methods').then((r) => setMethods(r.rows)).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    get('/payments', { q, method, page, limit: 25, from: range.from, to: range.to })
      .then(setData).catch(setError).finally(() => setLoading(false));
  }, [q, method, page, range]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const confirmReverse = async () => {
    setBusy(true);
    try {
      await del(`/payments/${reverse.id}`);
      toast.success('Payment reversed', 'The invoice balance was restored');
      setReverse(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const s = data?.summary || {};

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Cash in"
        title="Payments"
        description="Every rupee received, matched to the invoice it settles. Reversing a payment automatically reopens the invoice."
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => downloadCsv('/reports/export.csv', { type: 'payments', ...range }).catch((e) => toast.error(e.message))}>
              <Icon name="download" className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}>
              <Icon name="plus" className="w-3.5 h-3.5" /> Record payment
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total collected (filtered)" value={money(s.total, symbol)} sub={`${num(s.c)} payments`} icon="wallet" tone="green" />
        <StatCard label="Methods in use" value={num(s.byMethod?.length || 0)} icon="card" tone="brand" />
        <StatCard label="Largest channel" value={s.byMethod?.[0] ? titleise(s.byMethod[0].method) : '—'}
          sub={s.byMethod?.[0] ? money(s.byMethod[0].amount, symbol) : ''} icon="trending" tone="violet" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 items-start">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-100">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search payment, invoice or reference…" className="pl-9 h-9" />
            </div>
            <Select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className="w-[150px] h-9">
              <option value="">All methods</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
            <Input type="date" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1); }} className="w-[150px] h-9" />
            <Input type="date" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1); }} className="w-[150px] h-9" />
          </div>

          {error ? <ErrorState error={error} onRetry={load} /> : loading && !data ? <Loading /> : (
            <>
              <Table
                columns={[
                  { key: 'number', label: 'Payment', render: (r) => <span className="font-mono text-[12.5px] font-semibold text-ink-900">{r.number}</span> },
                  { key: 'payment_date', label: 'Date', render: (r) => <span className="text-[12.5px] text-ink-600">{date(r.payment_date)}</span> },
                  {
                    key: 'customer', label: 'Customer',
                    render: (r) => (
                      <div className="flex items-center gap-2">
                        <Avatar name={r.company_name || r.customer_name} size="xs" />
                        <div className="min-w-0">
                          <div className="text-[13px] text-ink-800 truncate max-w-[170px]">{r.company_name || r.customer_name}</div>
                          <button className="text-[11px] font-mono text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/app/invoices?q=${r.invoice_number}`); }}>
                            {r.invoice_number}
                          </button>
                        </div>
                      </div>
                    ),
                  },
                  { key: 'method', label: 'Method', render: (r) => <span className="text-[12.5px] text-ink-600">{titleise(r.method)}</span> },
                  { key: 'reference', label: 'Reference', render: (r) => <span className="text-[11.5px] font-mono text-ink-400">{r.reference || '—'}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="tabular font-semibold text-emerald-700">{money(r.amount, symbol)}</span> },
                  {
                    key: 'actions', label: '', align: 'right', width: 60,
                    render: (r) => isAdmin ? (
                      <button className="btn-ghost btn-sm text-rose-500" onClick={(e) => { e.stopPropagation(); setReverse(r); }} title="Reverse payment">
                        <Icon name="trash" className="w-3.5 h-3.5" />
                      </button>
                    ) : null,
                  },
                ]}
                rows={data?.rows || []}
                onRowClick={(r) => navigate(`/app/invoices?q=${r.invoice_number}`)}
                empty={<EmptyState icon="wallet" title="No payments yet" description="Payments recorded against invoices will show up here." />}
              />
              <Pagination page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} limit={data?.limit || 25} onPage={setPage} />
            </>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink-900 mb-3">Split by method</h3>
          {!s.byMethod?.length ? <p className="text-[12.5px] text-ink-400">No data.</p> : (
            <div className="space-y-3">
              {s.byMethod.map((m) => {
                const max = Math.max(...s.byMethod.map((x) => x.amount), 1);
                return (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-ink-600">{titleise(m.method)}</span>
                      <span className="tabular font-medium text-ink-900">{money(m.amount, symbol)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${(m.amount / max) * 100}%` }} />
                    </div>
                    <div className="text-[10.5px] text-ink-400 mt-0.5">{m.c} payments</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!reverse} onClose={() => setReverse(null)} onConfirm={confirmReverse} busy={busy}
        title="Reverse this payment?"
        message={reverse ? `${money(reverse.amount, symbol)} recorded against ${reverse.invoice_number} will be removed and the invoice balance restored.` : ''}
        confirmLabel="Reverse payment" tone="danger"
      />

      <QuickPaymentModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={load} symbol={symbol} />
    </div>
  );
}

/* Pick an open invoice, then record a payment against it. */
function QuickPaymentModal({ open, onClose, onSaved, symbol }) {
  const toast = useToast();
  const [invoices, setInvoices] = useState([]);
  const [form, setForm] = useState({ invoice_id: '', amount: '', method: 'bank_transfer', payment_date: today(), note: '', reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState([]);

  useEffect(() => {
    if (!open) return;
    get('/payments/methods').then((r) => setMethods(r.rows)).catch(() => {});
    get('/invoices', { status: 'outstanding', limit: 100 }).then((r) => setInvoices(r.rows)).catch(() => {});
    setForm({ invoice_id: '', amount: '', method: 'bank_transfer', payment_date: today(), note: '', reference: '' });
    setError('');
  }, [open]);

  const selected = useMemo(() => invoices.find((i) => String(i.id) === String(form.invoice_id)), [invoices, form.invoice_id]);

  useEffect(() => {
    if (selected) setForm((f) => ({ ...f, amount: selected.balance }));
  }, [selected]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await post('/payments', {
        ...form, invoice_id: Number(form.invoice_id), amount: Number(form.amount),
      });
      toast.success(`${money(res.row.amount, symbol)} recorded`, res.fully_paid ? 'Invoice settled' : `Balance ${money(res.invoice.balance, symbol)}`);
      onSaved?.(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a payment"
      description="Pick an open invoice and log what came in."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.invoice_id || !form.amount}>Record payment</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <Field label="Invoice" required>
          <Select value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
            <option value="">Select an open invoice…</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>{i.number} — {i.company_name || i.customer_name} — {money(i.balance, symbol)} due</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" required><Input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Method">
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Date"><Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></Field>
          <Field label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="UTR / cheque no." /></Field>
        </div>
        <Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field>
      </div>
    </Modal>
  );
}
