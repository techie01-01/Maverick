import { useCallback, useEffect, useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Loading, Menu, Modal,
  SectionHeader, Select, Spinner, StatCard, Switch, Table, Textarea, useToast,
} from '../components/ui.jsx';
import { date, money, num, relative, titleise, today } from '../lib/format.js';

export default function DiscountsPage() {
  const { settings, isAdmin } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    get('/discounts').then(setData).catch(setError);
    get('/products', { limit: 100 }).then((r) => setProducts(r.rows)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setBusy(true);
    try { await del(`/discounts/${deleting.id}`); toast.success('Discount deleted'); setDeleting(null); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const toggle = async (d) => {
    try { await patch(`/discounts/${d.id}`, { is_active: d.is_active ? 0 : 1 }); load(); }
    catch (e) { toast.error(e.message); }
  };

  const s = data?.summary || {};

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Pricing"
        title="Discounts"
        description="Rules the admin controls. A live rule is applied to the next invoice automatically and stops the moment it expires or runs out of uses — nobody has to remember it."
        actions={isAdmin ? <button className="btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="plus" className="w-3.5 h-3.5" /> New discount rule</button> : null}
      />

      {!isAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2">
          <Icon name="lock" className="w-4 h-4 mt-0.5 shrink-0" />
          Only the administrator can create or change discount rules. You can still see which rules are live.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Live rules" value={num(s.live || 0)} sub={`${s.total || 0} total`} icon="tag" tone="green" />
        <StatCard label="Expired" value={num(s.expired || 0)} sub="Stopped applying" icon="clock" tone="ink" />
        <StatCard label="Exhausted" value={num(s.exhausted || 0)} sub="Used up" icon="xCircle" tone="amber" />
        <StatCard label="Total given away" value={money(s.saving || 0, symbol)} icon="percent" tone="brand" />
      </div>

      {error ? <ErrorState error={error} onRetry={load} /> : !data ? <Loading /> : (
        <Card className="overflow-hidden">
          <Table
            columns={[
              {
                key: 'name', label: 'Rule',
                render: (r) => (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-ink-900">{r.name}</span>
                      <span className="text-[10px] font-mono bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">{r.code}</span>
                    </div>
                    <div className="text-[11.5px] text-ink-500 mt-0.5">
                      {r.applies_to === 'products'
                        ? `Only on ${r.products.map((p) => p.name).join(', ') || 'selected products'}`
                        : 'Whole subscription'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'value', label: 'Value', align: 'right',
                render: (r) => <span className="tabular font-semibold text-ink-900">{r.kind === 'percent' ? `${r.value}%` : money(r.value, symbol)}</span>,
              },
              {
                key: 'conditions', label: 'Conditions',
                render: (r) => (
                  <div className="text-[11.5px] text-ink-600 space-y-0.5">
                    {r.min_quantity > 0 && <div>Min {r.min_quantity} seats</div>}
                    {r.min_purchase > 0 && <div>Min spend {money(r.min_purchase, symbol)}</div>}
                    {!r.min_quantity && !r.min_purchase && <span className="text-ink-400">None</span>}
                  </div>
                ),
              },
              {
                key: 'window', label: 'Valid',
                render: (r) => (
                  <div className="text-[11.5px]">
                    <div className="text-ink-700">{r.start_date ? date(r.start_date) : 'Any time'} → {r.end_date ? date(r.end_date) : 'No end'}</div>
                    {r.end_date && <div className="text-ink-400">{relative(r.end_date)}</div>}
                  </div>
                ),
              },
              {
                key: 'uses', label: 'Used',
                render: (r) => (
                  <div className="text-[11.5px]">
                    <div className="tabular text-ink-800 font-medium">{r.used_count}{r.max_uses > 0 ? ` / ${r.max_uses}` : ''}</div>
                    <div className="text-ink-400">{money(r.usage_amount, symbol)} given</div>
                  </div>
                ),
              },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'live' ? 'green' : r.status === 'scheduled' ? 'sky' : r.status === 'exhausted' ? 'amber' : 'ink'}>{titleise(r.status)}</Badge> },
              {
                key: 'actions', label: '', align: 'right',
                render: (r) => isAdmin ? (
                  <Menu align="right" trigger={<button className="btn-ghost btn-sm"><Icon name="settings" className="w-4 h-4" /></button>}
                    items={[
                      { label: 'Edit rule', icon: 'edit', onClick: () => setEditing(r) },
                      { label: r.is_active ? 'Deactivate' : 'Activate', icon: 'pause', onClick: () => toggle(r) },
                      { divider: true },
                      { label: 'Delete', icon: 'trash', danger: true, onClick: () => setDeleting(r) },
                    ]} />
                ) : null,
              },
            ]}
            rows={data.rows}
            empty={<EmptyState icon="tag" title="No discount rules" description="Create a rule to reward customers who take more seats or sign up early." />}
          />
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold text-ink-900">Discount simulator</h3>
        <p className="text-[12px] text-ink-500 mt-0.5 mb-4">See which rule would fire for a given order, right now.</p>
        <Simulator symbol={symbol} preview={preview} setPreview={setPreview} />
      </Card>

      <DiscountModal open={!!editing} onClose={() => setEditing(null)} discount={editing} products={products} onSaved={load} symbol={symbol} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} busy={busy}
        title="Delete discount rule?" message={`“${deleting?.name}” will be removed. Rules already redeemed cannot be deleted — deactivate them instead.`}
        confirmLabel="Delete" tone="danger" />
    </div>
  );
}

function Simulator({ symbol, preview, setPreview }) {
  const [form, setForm] = useState({ subtotal: 25000, quantity: 12 });
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await post('/discounts/preview', { subtotal: Number(form.subtotal), quantity: Number(form.quantity), as_of: today() });
      setPreview(res);
    } catch { setPreview(null); } finally { setBusy(false); }
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <Field label="Order value (before tax)">
          <Input type="number" min="0" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} />
        </Field>
        <Field label="Quantity / seats">
          <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        </Field>
        <button className="btn-secondary w-full" onClick={run} disabled={busy}>
          {busy ? <Spinner className="w-4 h-4" /> : <Icon name="zap" className="w-4 h-4" />} Simulate
        </button>
        {preview?.best && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Best rule wins</div>
            <div className="text-[13px] font-semibold text-emerald-900 mt-0.5">{preview.best.name}</div>
            <div className="text-[20px] font-semibold text-emerald-700 tabular mt-1">{money(preview.best.saving, symbol)}</div>
            <div className="text-[11px] text-emerald-700">off a {money(preview.best.base ?? form.subtotal, symbol)} order</div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-ink-200 overflow-hidden">
        <table className="w-full">
          <thead><tr className="bg-ink-50 border-b border-ink-100">
            <th className="th">Rule</th><th className="th">Value</th><th className="th">Qualifies</th><th className="th text-right">Saving</th>
          </tr></thead>
          <tbody className="divide-y divide-ink-100">
            {(preview?.rows || []).map((r) => (
              <tr key={r.id} className={r.qualifies ? 'bg-emerald-50/40' : ''}>
                <td className="td"><div className="text-[12.5px] font-medium text-ink-900">{r.name}</div><div className="text-[10.5px] font-mono text-ink-400">{r.code}</div></td>
                <td className="td text-[12.5px]">{r.kind === 'percent' ? `${r.value}%` : money(r.value, symbol)}</td>
                <td className="td">{r.qualifies ? <Badge tone="green">Yes</Badge> : <Badge tone="ink">No</Badge>}</td>
                <td className="td text-right tabular">{r.qualifies ? money(r.saving, symbol) : '—'}</td>
              </tr>
            ))}
            {!preview?.rows?.length && <tr><td className="td text-ink-400 text-[12.5px]" colSpan={4}>No discount rules exist.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiscountModal({ open, onClose, discount, products, onSaved, symbol }) {
  const isEdit = !!discount?.id;
  const toast = useToast();
  const [form, setForm] = useState({});
  const [productIds, setProductIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({ ...discount });
      setProductIds((discount.products || []).map((p) => p.id));
    } else {
      setForm({
        code: '', name: '', kind: 'percent', value: 10, min_purchase: 0, min_quantity: 0,
        start_date: today(), end_date: '', max_uses: 0, applies_to: 'subscription', scope_note: '',
      });
      setProductIds([]);
    }
    setError('');
  }, [open, isEdit, discount]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const payload = {
        ...form,
        value: Number(form.value), min_purchase: Number(form.min_purchase || 0),
        min_quantity: Number(form.min_quantity || 0), max_uses: Number(form.max_uses || 0),
        start_date: form.start_date || null, end_date: form.end_date || null,
        product_ids: productIds,
      };
      if (isEdit) await patch(`/discounts/${discount.id}`, payload);
      else await post('/discounts', payload);
      toast.success(isEdit ? 'Discount updated' : 'Discount created');
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={isEdit ? 'Edit discount rule' : 'New discount rule'}
      description="Applies automatically to the next invoice, and stops on its own when it expires or hits the usage limit."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.code || !form.name}>{busy && <Spinner className="w-4 h-4" />} Save rule</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rule name" required><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Volume discount — 10 seats" /></Field>
          <Field label="Code" required hint={isEdit ? 'Cannot be changed after creation' : ''}>
            <Input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="VOLUME10" disabled={isEdit} />
          </Field>
          <Field label="Discount type">
            <Select value={form.kind || 'percent'} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="percent">Percentage off</option><option value="fixed">Fixed amount off</option>
            </Select>
          </Field>
          <Field label={form.kind === 'fixed' ? `Amount (${symbol})` : 'Percentage %'} required>
            <Input type="number" min="0" step="0.01" max={form.kind === 'percent' ? 100 : undefined}
              value={form.value ?? 0} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies to">
            <Select value={form.applies_to || 'subscription'} onChange={(e) => setForm({ ...form, applies_to: e.target.value })}>
              <option value="subscription">Whole subscription</option>
              <option value="products">Specific products only</option>
            </Select>
          </Field>
          <Field label="Minimum quantity" hint="0 = no minimum"><Input type="number" min="0" value={form.min_quantity ?? 0} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} /></Field>
        </div>

        {form.applies_to === 'products' && (
          <div>
            <label className="label">Products this rule applies to</label>
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <button key={p.id} onClick={() => setProductIds(productIds.includes(p.id) ? productIds.filter((x) => x !== p.id) : [...productIds, p.id])}
                  className={`chip transition ${productIds.includes(p.id) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-600 ring-ink-200 hover:ring-ink-300'}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum purchase" hint={`Order value in ${symbol}`}>
            <Input type="number" min="0" value={form.min_purchase ?? 0} onChange={(e) => setForm({ ...form, min_purchase: e.target.value })} />
          </Field>
          <Field label="Starts on"><Input type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="Ends on" hint="Blank = never expires"><Input type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        </div>

        <Field label="Maximum uses" hint="0 = unlimited. The rule stops applying once the limit is reached.">
          <Input type="number" min="0" value={form.max_uses ?? 0} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} className="w-40" />
        </Field>

        <Field label="Internal note"><Textarea rows={2} value={form.scope_note || ''} onChange={(e) => setForm({ ...form, scope_note: e.target.value })} placeholder="Why this rule exists / who approved it" /></Field>

        {isEdit && (
          <Switch checked={!!form.is_active} onChange={(v) => setForm({ ...form, is_active: v ? 1 : 0 })}
            label="Rule is active" description="Deactivating stops it applying to any new invoice immediately." />
        )}

        <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3 text-[12px] text-brand-800 flex items-start gap-2">
          <Icon name="sparkles" className="w-4 h-4 mt-0.5 shrink-0" />
          When several rules qualify, the customer automatically gets the most generous one — rules never stack.
        </div>
      </div>
    </Modal>
  );
}
