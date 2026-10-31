import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Loading, Menu, Modal,
  SectionHeader, Select, Spinner, StatCard, Switch, Table, Tabs, Textarea, useToast,
} from '../components/ui.jsx';
import { cadence, date, money, num, titleise } from '../lib/format.js';

/* ==================================================================== */
/* PRODUCTS                                                              */
/* ==================================================================== */
export function ProductsPage() {
  const { settings, isAdmin } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();

  const [data, setData] = useState(null);
  const [taxes, setTaxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    get('/products', { q, type, page, limit: 12 }).then(setData).catch(setError).finally(() => setLoading(false));
  }, [q, type, page]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { get('/taxes').then((r) => setTaxes(r.rows)).catch(() => {}); }, []);

  const remove = async () => {
    setBusy(true);
    try { await del(`/products/${deleting.id}`); toast.success('Product deleted'); setDeleting(null); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Catalogue"
        title="Products"
        description="What Brightloop sells — with variants such as brand that add to the base price, and the tax rules that follow each item."
        actions={isAdmin ? (
          <button className="btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="plus" className="w-3.5 h-3.5" /> New product</button>
        ) : null}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-100">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search products…" className="pl-9 h-9" />
          </div>
          <Tabs tabs={[{ id: '', label: 'All' }, { id: 'service', label: 'Services' }, { id: 'goods', label: 'Goods' }, { id: 'digital', label: 'Digital' }]}
            value={type} onChange={(v) => { setType(v); setPage(1); }} />
        </div>

        {error ? <ErrorState error={error} onRetry={load} /> : loading && !data ? <Loading /> : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {data?.rows?.length === 0 && <div className="col-span-full"><EmptyState icon="box" title="No products" description="Add your first product to start building plans." /></div>}
            {data?.rows?.map((p) => (
              <div key={p.id} className="rounded-xl border border-ink-200 p-4 hover:border-brand-300 hover:shadow-lift transition-all group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-ink-900 truncate">{p.name}</h3>
                      {!p.is_active && <Badge>Archived</Badge>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge tone={p.type === 'service' ? 'brand' : p.type === 'goods' ? 'amber' : 'violet'}>{titleise(p.type)}</Badge>
                      {p.sku && <span className="text-[10.5px] font-mono text-ink-400">{p.sku}</span>}
                    </div>
                  </div>
                  {isAdmin && (
                    <Menu align="right" trigger={
                      <button className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 opacity-0 group-hover:opacity-100 transition"><Icon name="settings" className="w-4 h-4" /></button>
                    } items={[
                      { label: 'Edit product', icon: 'edit', onClick: () => setEditing(p) },
                      { label: p.is_active ? 'Archive' : 'Restore', icon: 'box', onClick: () => patch(`/products/${p.id}`, { is_active: p.is_active ? 0 : 1 }).then(load).catch((e) => toast.error(e.message)) },
                      { divider: true },
                      { label: 'Delete', icon: 'trash', danger: true, onClick: () => setDeleting(p) },
                    ]} />
                  )}
                </div>

                <p className="text-[12px] text-ink-500 mt-2 line-clamp-2 min-h-[32px]">{p.notes || 'No description.'}</p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-ink-50 px-2.5 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-ink-400">Sales price</div>
                    <div className="text-[13px] font-semibold text-ink-900 tabular">{money(p.sales_price, symbol)}</div>
                  </div>
                  <div className="rounded-lg bg-ink-50 px-2.5 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-ink-400">Cost price</div>
                    <div className="text-[13px] font-medium text-ink-600 tabular">{money(p.cost_price, symbol)}</div>
                  </div>
                </div>

                {p.variants?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-ink-400 mb-1">Variants</div>
                    <div className="flex flex-wrap gap-1">
                      {p.variants.map((v) => (
                        <span key={v.id} className="chip bg-white text-ink-600 ring-ink-200">
                          {v.attribute_value}
                          {v.price_extra !== 0 && <span className="text-brand-600 font-semibold">{v.price_extra > 0 ? `+${money(v.price_extra, symbol)}` : money(v.price_extra, symbol)}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-ink-100 flex items-center justify-between text-[11px] text-ink-500">
                  <span className="flex items-center gap-1"><Icon name="percent" className="w-3 h-3" /> {p.tax_names || 'No tax'}</span>
                  <span className="flex items-center gap-1"><Icon name="layers" className="w-3 h-3" /> {p.plan_count} plan(s)</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data?.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-ink-100">
            <span className="text-[12.5px] text-ink-500">{data.total} products</span>
            <div className="flex gap-1">
              <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon name="chevronLeft" className="w-4 h-4" /></button>
              <span className="px-2 text-[12.5px] text-ink-500 tabular self-center">{page} / {data.pages}</span>
              <button className="btn-ghost btn-sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}><Icon name="chevronRight" className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </Card>

      <ProductModal open={!!editing} onClose={() => setEditing(null)} product={editing} taxes={taxes} onSaved={load} symbol={symbol} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} busy={busy}
        title="Delete this product?" message={`“${deleting?.name}” will be removed. Products used by a plan cannot be deleted — archive them instead.`}
        confirmLabel="Delete" tone="danger" />
    </div>
  );
}

function ProductModal({ open, onClose, product, taxes, onSaved, symbol }) {
  const isEdit = !!product?.id;
  const toast = useToast();
  const [form, setForm] = useState({ name: '', sku: '', type: 'service', sales_price: 0, cost_price: 0, notes: '' });
  const [variants, setVariants] = useState([]);
  const [taxIds, setTaxIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      get(`/products/${product.id}`).then((r) => {
        const p = r.row;
        setForm({ name: p.name, sku: p.sku || '', type: p.type, sales_price: p.sales_price, cost_price: p.cost_price, notes: p.notes || '' });
        setVariants(p.variants.map((v) => ({ attribute_name: v.attribute_name, attribute_value: v.attribute_value, price_extra: v.price_extra })));
        setTaxIds(p.taxes.map((t) => t.id));
      }).catch((e) => setError(e.message));
    } else {
      setForm({ name: '', sku: '', type: 'service', sales_price: 0, cost_price: 0, notes: '' });
      setVariants([{ attribute_name: 'Brand', attribute_value: 'Odoo', price_extra: 560 }]);
      setTaxIds(taxes.filter((t) => t.is_active && t.applies_to === 'all').map((t) => t.id));
    }
    setError('');
  }, [open, isEdit, product, taxes]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const payload = {
        ...form, sales_price: Number(form.sales_price), cost_price: Number(form.cost_price),
        variants: variants.filter((v) => v.attribute_value).map((v) => ({ ...v, price_extra: Number(v.price_extra) })),
        tax_ids: taxIds,
      };
      if (isEdit) await patch(`/products/${product.id}`, payload);
      else await post('/products', payload);
      toast.success(isEdit ? 'Product updated' : 'Product created');
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={isEdit ? 'Edit product' : 'New product'}
      description="Variants let the same product carry different prices — for example a brand that adds 560 to the base."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.name}>{busy && <Spinner className="w-4 h-4" />} {isEdit ? 'Save changes' : 'Create product'}</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Brightloop Business Suite" /></Field>
          <Field label="SKU / reference"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="BLS-SUITE" /></Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="service">Service</option><option value="goods">Goods</option><option value="digital">Digital</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sales price" required><Input type="number" min="0" step="0.01" value={form.sales_price} onChange={(e) => setForm({ ...form, sales_price: e.target.value })} /></Field>
            <Field label="Cost price"><Input type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></Field>
          </div>
        </div>

        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What this product is and who it's for…" /></Field>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Variants</label>
            <button className="btn-ghost btn-sm" onClick={() => setVariants([...variants, { attribute_name: 'Brand', attribute_value: '', price_extra: 0 }])}>
              <Icon name="plus" className="w-3.5 h-3.5" /> Add variant
            </button>
          </div>
          {variants.length === 0 ? (
            <p className="text-[12.5px] text-ink-400 rounded-lg border border-dashed border-ink-200 px-3 py-3 text-center">No variants — one price for everyone.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[130px_1fr_120px_32px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400 px-1">
                <span>Attribute</span><span>Value</span><span>Price add-on</span><span />
              </div>
              {variants.map((v, i) => (
                <div key={i} className="grid grid-cols-[130px_1fr_120px_32px] gap-2">
                  <Input value={v.attribute_name} onChange={(e) => { const n = [...variants]; n[i].attribute_name = e.target.value; setVariants(n); }} placeholder="Brand" />
                  <Input value={v.attribute_value} onChange={(e) => { const n = [...variants]; n[i].attribute_value = e.target.value; setVariants(n); }} placeholder="Odoo" />
                  <div className="relative">
                    <Input type="number" step="0.01" value={v.price_extra} onChange={(e) => { const n = [...variants]; n[i].price_extra = e.target.value; setVariants(n); }} className="pl-6" />
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 text-[12px]">{symbol}</span>
                  </div>
                  <button className="btn-ghost btn-sm text-rose-500" onClick={() => setVariants(variants.filter((_, x) => x !== i))}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label">Default taxes</label>
          <div className="flex flex-wrap gap-2">
            {taxes.filter((t) => t.is_active).map((t) => (
              <button key={t.id} onClick={() => setTaxIds(taxIds.includes(t.id) ? taxIds.filter((x) => x !== t.id) : [...taxIds, t.id])}
                className={`chip transition ${taxIds.includes(t.id) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-600 ring-ink-200 hover:ring-ink-300'}`}>
                {t.name}
              </button>
            ))}
            {taxes.length === 0 && <p className="text-[12.5px] text-ink-400">No tax rules yet — create one under Taxes.</p>}
          </div>
          <p className="text-[11.5px] text-ink-400 mt-1.5">These are applied automatically to every invoice line for this product.</p>
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* PLANS                                                                 */
/* ==================================================================== */
export function PlansPage() {
  const { settings, isAdmin } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setError(null);
    get('/plans').then((r) => setRows(r.rows)).catch(setError);
  }, []);

  useEffect(() => { load(); get('/products', { limit: 100 }).then((r) => setProducts(r.rows)).catch(() => {}); }, [load]);

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Catalogue"
        title="Plans"
        description="The price and cadence behind every subscription, plus the rules each plan allows: pause, close early, renew, or auto-close at the end of the term."
        actions={isAdmin ? <button className="btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="plus" className="w-3.5 h-3.5" /> New plan</button> : null}
      />

      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? <Loading /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.length === 0 && <div className="col-span-full"><Card><EmptyState icon="layers" title="No plans yet" description="A plan turns a product into something you can bill for." /></Card></div>}
          {rows.map((p) => (
            <Card key={p.id} className="p-4 hover:shadow-lift transition-all group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-ink-900 truncate">{p.name}</h3>
                    {!p.is_active && <Badge>Archived</Badge>}
                  </div>
                  <p className="text-[11.5px] text-ink-500 mt-0.5">{p.product_name}</p>
                </div>
                {isAdmin && (
                  <Menu align="right" trigger={<button className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 opacity-0 group-hover:opacity-100"><Icon name="settings" className="w-4 h-4" /></button>}
                    items={[
                      { label: 'Edit plan', icon: 'edit', onClick: () => setEditing(p) },
                      { label: p.is_active ? 'Archive' : 'Restore', icon: 'box', onClick: () => patch(`/plans/${p.id}`, { is_active: p.is_active ? 0 : 1 }).then(load).catch((e) => toast.error(e.message)) },
                    ]} />
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[22px] font-semibold text-ink-900 tabular">{money(p.price, symbol)}</span>
                <span className="text-[12px] text-ink-500">/ {p.billing_period === 'daily' ? 'day' : p.billing_period === 'weekly' ? 'week' : p.billing_period === 'monthly' ? 'month' : 'year'}</span>
              </div>
              <div className="text-[11.5px] text-ink-500">{cadence(p.billing_period, p.interval_count)} · min {p.min_quantity} qty</div>

              <div className="mt-3 flex flex-wrap gap-1">
                {p.allow_pause ? <Badge tone="violet">Pausable</Badge> : null}
                {p.allow_close ? <Badge tone="amber">Closable early</Badge> : null}
                {p.allow_renew ? <Badge tone="green">Renewable</Badge> : <Badge>No renewal</Badge>}
                {p.close_on_end ? <Badge tone="sky">Auto-close</Badge> : null}
              </div>

              <div className="mt-3 pt-3 border-t border-ink-100 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="text-ink-400">Available</div>
                  <div className="text-ink-700">{p.available_from ? date(p.available_from) : 'Any time'}{p.available_to ? ` – ${date(p.available_to)}` : ''}</div>
                </div>
                <div>
                  <div className="text-ink-400">Active subs</div>
                  <div className="text-ink-700 font-medium">{num(p.active_subs)}</div>
                </div>
              </div>
              {p.max_renewals > 0 && <p className="text-[10.5px] text-ink-400 mt-2">Renews at most {p.max_renewals}×</p>}
            </Card>
          ))}
        </div>
      )}

      <PlanModal open={!!editing} onClose={() => setEditing(null)} plan={editing} products={products} onSaved={load} symbol={symbol} />
    </div>
  );
}

function PlanModal({ open, onClose, plan, products, onSaved, symbol }) {
  const isEdit = !!plan?.id;
  const toast = useToast();
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(isEdit ? { ...plan } : {
      name: '', code: '', product_id: products[0]?.id || '', billing_period: 'monthly', interval_count: 1,
      price: 0, min_quantity: 1, available_from: '', available_to: '',
      allow_close: 1, allow_pause: 1, allow_renew: 1, close_on_end: 1, max_renewals: 0, trial_days: 0, notes: '',
    });
    setError('');
  }, [open, isEdit, plan, products]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const payload = {
        ...form,
        product_id: Number(form.product_id), interval_count: Number(form.interval_count),
        price: Number(form.price), min_quantity: Number(form.min_quantity),
        max_renewals: Number(form.max_renewals || 0), trial_days: Number(form.trial_days || 0),
        available_from: form.available_from || null, available_to: form.available_to || null,
      };
      if (isEdit) await patch(`/plans/${plan.id}`, payload); else await post('/plans', payload);
      toast.success(isEdit ? 'Plan updated' : 'Plan created');
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={isEdit ? 'Edit plan' : 'New plan'}
      description="Decide how it bills and exactly which lifecycle actions the team is allowed to take."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.name || !form.product_id}>{busy && <Spinner className="w-4 h-4" />} {isEdit ? 'Save plan' : 'Create plan'}</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" required><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Growth Monthly" /></Field>
          <Field label="Code"><Input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="GROWTH-M" /></Field>
          <Field label="Product" required>
            <Select value={form.product_id || ''} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              <option value="">Select…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Billing period">
            <Select value={form.billing_period || 'monthly'} onChange={(e) => setForm({ ...form, billing_period: e.target.value })}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
            </Select>
          </Field>
          <Field label="Every N periods" hint="e.g. 3 with monthly = quarterly">
            <Input type="number" min="1" value={form.interval_count ?? 1} onChange={(e) => setForm({ ...form, interval_count: e.target.value })} />
          </Field>
          <Field label="Price per period" required>
            <Input type="number" min="0" step="0.01" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="Minimum quantity">
            <Input type="number" min="1" value={form.min_quantity ?? 1} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} />
          </Field>
          <Field label="Trial days"><Input type="number" min="0" value={form.trial_days ?? 0} onChange={(e) => setForm({ ...form, trial_days: e.target.value })} /></Field>
          <Field label="Available from"><Input type="date" value={form.available_from || ''} onChange={(e) => setForm({ ...form, available_from: e.target.value })} /></Field>
          <Field label="Available to" hint="Leave empty for no end date"><Input type="date" value={form.available_to || ''} onChange={(e) => setForm({ ...form, available_to: e.target.value })} /></Field>
        </div>

        <div className="rounded-xl border border-ink-200 p-4 space-y-3">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Lifecycle permissions</div>
          <Switch checked={!!form.allow_pause} onChange={(v) => setForm({ ...form, allow_pause: v ? 1 : 0 })}
            label="Can be paused" description="Billing stops while paused and resumes from today." />
          <Switch checked={!!form.allow_close} onChange={(v) => setForm({ ...form, allow_close: v ? 1 : 0 })}
            label="Can be closed early" description="Allow the team to terminate before the expiry date." />
          <Switch checked={!!form.allow_renew} onChange={(v) => setForm({ ...form, allow_renew: v ? 1 : 0 })}
            label="Can be renewed" description="Extend the term by one more cycle." />
          <Switch checked={!!form.close_on_end} onChange={(v) => setForm({ ...form, close_on_end: v ? 1 : 0 })}
            label="Close automatically at term end" description="Otherwise the subscription simply expires and stays visible." />
          {!!form.allow_renew && (
            <Field label="Maximum renewals" hint="0 means unlimited">
              <Input type="number" min="0" value={form.max_renewals ?? 0} onChange={(e) => setForm({ ...form, max_renewals: e.target.value })} className="w-32" />
            </Field>
          )}
        </div>

        <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>

        <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3 text-[12px] text-brand-800 flex items-start gap-2">
          <Icon name="info" className="w-4 h-4 mt-0.5 shrink-0" />
          Example: {cadence(form.billing_period || 'monthly', Number(form.interval_count) || 1)} at {money(Number(form.price) || 0, symbol)} per unit, minimum {form.min_quantity || 1} units.
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* TAXES                                                                 */
/* ==================================================================== */
export function TaxesPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { get('/taxes').then((r) => setRows(r.rows)).catch(setError); }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setBusy(true);
    try { await del(`/taxes/${deleting.id}`); toast.success('Tax rule deleted'); setDeleting(null); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Catalogue"
        title="Tax rules"
        description="Set them once here — every invoice line picks up the right rate automatically based on the product it belongs to."
        actions={isAdmin ? <button className="btn-primary btn-sm" onClick={() => setModal({})}><Icon name="plus" className="w-3.5 h-3.5" /> New tax rule</button> : null}
      />

      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? <Loading /> : (
        <Card className="overflow-hidden">
          <Table
            columns={[
              { key: 'name', label: 'Tax rule', render: (r) => (
                <div>
                  <div className="text-[13px] font-medium text-ink-900 flex items-center gap-2">
                    {r.name} {!r.is_active && <Badge>Inactive</Badge>}
                  </div>
                  {r.code && <div className="text-[11px] font-mono text-ink-400">{r.code}</div>}
                </div>
              ) },
              { key: 'rate', label: 'Rate', align: 'right', render: (r) => (
                <span className="tabular font-semibold text-ink-900">{r.kind === 'percent' ? `${r.rate}%` : money(r.fixed_amount)}</span>
              ) },
              { key: 'applies_to', label: 'Applies to', render: (r) => <Badge tone="brand">{r.applies_to === 'all' ? 'Everything' : titleise(r.applies_to)}</Badge> },
              { key: 'included', label: 'Price includes tax', render: (r) => r.included_in_price ? <Badge tone="green">Yes</Badge> : <span className="text-ink-400 text-[12.5px]">No</span> },
              { key: 'country', label: 'Region', render: (r) => <span className="text-[12.5px] text-ink-500">{r.country || 'All'}</span> },
              {
                key: 'actions', label: '', align: 'right',
                render: (r) => isAdmin ? (
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => setModal(r)}><Icon name="edit" className="w-3.5 h-3.5" /></button>
                    <button className="btn-ghost btn-sm text-rose-500" onClick={() => setDeleting(r)}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                  </div>
                ) : null,
              },
            ]}
            rows={rows}
            empty={<EmptyState icon="percent" title="No tax rules" description="Add GST or any other rate your invoices must show." />}
          />
        </Card>
      )}

      <TaxModal open={!!modal} onClose={() => setModal(null)} tax={modal} onSaved={load} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} busy={busy}
        title="Delete tax rule?" message={`“${deleting?.name}” will be removed. If a product uses it, deactivate the rule instead.`} confirmLabel="Delete" tone="danger" />
    </div>
  );
}

function TaxModal({ open, onClose, tax, onSaved }) {
  const isEdit = !!tax?.id;
  const toast = useToast();
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(isEdit ? { ...tax } : { name: '', code: '', kind: 'percent', rate: 18, fixed_amount: 0, applies_to: 'all', included_in_price: 0, country: 'India' });
    setError('');
  }, [open, isEdit, tax]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const payload = { ...form, rate: Number(form.rate), fixed_amount: Number(form.fixed_amount) };
      if (isEdit) await patch(`/taxes/${tax.id}`, payload); else await post('/taxes', payload);
      toast.success(isEdit ? 'Tax rule updated' : 'Tax rule created');
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit tax rule' : 'New tax rule'}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.name}>{busy && <Spinner className="w-4 h-4" />} Save</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="GST 18%" /></Field>
          <Field label="Code"><Input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="GST18" /></Field>
          <Field label="Type">
            <Select value={form.kind || 'percent'} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="percent">Percentage</option><option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          {form.kind === 'fixed'
            ? <Field label="Amount"><Input type="number" step="0.01" value={form.fixed_amount ?? 0} onChange={(e) => setForm({ ...form, fixed_amount: e.target.value })} /></Field>
            : <Field label="Rate %"><Input type="number" step="0.1" value={form.rate ?? 0} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>}
          <Field label="Applies to">
            <Select value={form.applies_to || 'all'} onChange={(e) => setForm({ ...form, applies_to: e.target.value })}>
              <option value="all">Everything</option><option value="service">Services</option>
              <option value="goods">Goods</option><option value="digital">Digital</option>
            </Select>
          </Field>
          <Field label="Region"><Input value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="India" /></Field>
        </div>
        <Switch checked={!!form.included_in_price} onChange={(v) => setForm({ ...form, included_in_price: v ? 1 : 0 })}
          label="Prices already include this tax" description="Use when the listed price is tax-inclusive." />
        {isEdit && <Switch checked={!!form.is_active} onChange={(v) => setForm({ ...form, is_active: v ? 1 : 0 })} label="Active" />}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* QUOTATION TEMPLATES                                                   */
/* ==================================================================== */
export function TemplatesPage() {
  const { settings, isAdmin } = useAuth();
  const symbol = settings?.currency_symbol || '₹';
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [plans, setPlans] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => { get('/quotation-templates').then((r) => setRows(r.rows)).catch(setError); }, []);
  useEffect(() => {
    load();
    get('/plans').then((r) => setPlans(r.rows)).catch(() => {});
    get('/products', { limit: 100 }).then((r) => setProducts(r.rows)).catch(() => {});
  }, [load]);

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        eyebrow="Sales"
        title="Quotation templates"
        description="A ready-made offer — the right plan, the right add-on lines and a validity period — so a rep never builds a proposal from scratch."
        actions={isAdmin ? <button className="btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="plus" className="w-3.5 h-3.5" /> New template</button> : null}
      />

      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? <Loading /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.length === 0 && <div className="col-span-full"><Card><EmptyState icon="file" title="No templates" description="Save a common deal shape once and reuse it for every customer." /></Card></div>}
          {rows.map((t) => {
            const total = t.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-ink-900">{t.name}</h3>
                    <p className="text-[11.5px] text-ink-500 mt-0.5">{t.plan_name || 'No plan linked'}</p>
                  </div>
                  {isAdmin && (
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(t)}><Icon name="edit" className="w-3.5 h-3.5" /></button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  <Badge tone="brand">Valid {t.validity_days} days</Badge>
                  <Badge tone="sky">{t.payment_term === 'immediate' ? 'Due on receipt' : titleise(t.payment_term)}</Badge>
                  <Badge>{t.quantity} qty</Badge>
                </div>

                {t.lines.length > 0 && (
                  <div className="mt-3 border-t border-ink-100 pt-2.5 space-y-1">
                    {t.lines.map((l) => (
                      <div key={l.id} className="flex justify-between text-[12px]">
                        <span className="text-ink-600 truncate">{l.quantity} × {l.label || l.product_name}</span>
                        <span className="tabular text-ink-800 shrink-0 ml-2">{money(l.quantity * l.unit_price, symbol)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-[12px] pt-1.5 border-t border-ink-100 font-medium">
                      <span className="text-ink-700">Add-ons</span>
                      <span className="tabular text-ink-900">{money(total, symbol)}</span>
                    </div>
                  </div>
                )}

                {t.notes && <p className="text-[11.5px] text-ink-400 mt-2.5 line-clamp-2">{t.notes}</p>}
              </Card>
            );
          })}
        </div>
      )}

      <TemplateModal open={!!editing} onClose={() => setEditing(null)} template={editing}
        plans={plans} products={products} onSaved={load} symbol={symbol} />
    </div>
  );
}

function TemplateModal({ open, onClose, template, plans, products, onSaved, symbol }) {
  const isEdit = !!template?.id;
  const toast = useToast();
  const [form, setForm] = useState({});
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({ name: template.name, plan_id: template.plan_id, validity_days: template.validity_days, payment_term: template.payment_term, quantity: template.quantity, notes: template.notes || '' });
      setLines(template.lines.map((l) => ({ product_id: l.product_id, label: l.label || l.product_name, quantity: l.quantity, unit_price: l.unit_price })));
    } else {
      setForm({ name: '', plan_id: plans[0]?.id || '', validity_days: 30, payment_term: 'net30', quantity: 1, notes: '' });
      setLines([]);
    }
    setError('');
  }, [open, isEdit, template, plans]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const payload = {
        ...form, plan_id: form.plan_id ? Number(form.plan_id) : null,
        validity_days: Number(form.validity_days), quantity: Number(form.quantity),
        lines: lines.filter((l) => l.product_id).map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
      };
      if (isEdit) await patch(`/quotation-templates/${template.id}`, payload); else await post('/quotation-templates', payload);
      toast.success(isEdit ? 'Template updated' : 'Template created');
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={isEdit ? 'Edit template' : 'New quotation template'}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !form.name}>{busy && <Spinner className="w-4 h-4" />} Save template</button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name" required><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Enterprise Bundle (10 seats)" /></Field>
          <Field label="Plan">
            <Select value={form.plan_id || ''} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
              <option value="">No plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price, symbol)}/{p.billing_period}</option>)}
            </Select>
          </Field>
          <Field label="Valid for (days)"><Input type="number" min="1" value={form.validity_days ?? 30} onChange={(e) => setForm({ ...form, validity_days: e.target.value })} /></Field>
          <Field label="Payment terms">
            <Select value={form.payment_term || 'net30'} onChange={(e) => setForm({ ...form, payment_term: e.target.value })}>
              {['immediate', 'net7', 'net15', 'net30', 'net45', 'net60'].map((t) => <option key={t} value={t}>{t === 'immediate' ? 'Due on receipt' : titleise(t)}</option>)}
            </Select>
          </Field>
          <Field label="Default quantity"><Input type="number" min="1" value={form.quantity ?? 1} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Product lines</label>
            <button className="btn-ghost btn-sm" onClick={() => setLines([...lines, { product_id: products[0]?.id, label: products[0]?.name, quantity: 1, unit_price: products[0]?.sales_price || 0 }])}>
              <Icon name="plus" className="w-3.5 h-3.5" /> Add line
            </button>
          </div>
          {lines.length === 0 ? (
            <p className="text-[12.5px] text-ink-400 rounded-lg border border-dashed border-ink-200 px-3 py-3 text-center">The linked plan is added automatically; extra lines go here.</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_110px_32px] gap-2">
                  <Select value={l.product_id} onChange={(e) => {
                    const p = products.find((x) => String(x.id) === String(e.target.value));
                    const n = [...lines]; n[i] = { ...n[i], product_id: e.target.value, label: p?.name, unit_price: p?.sales_price || 0 }; setLines(n);
                  }}>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Input type="number" min="1" value={l.quantity} onChange={(e) => { const n = [...lines]; n[i].quantity = e.target.value; setLines(n); }} />
                  <Input type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => { const n = [...lines]; n[i].unit_price = e.target.value; setLines(n); }} />
                  <button className="btn-ghost btn-sm text-rose-500" onClick={() => setLines(lines.filter((_, x) => x !== i))}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
