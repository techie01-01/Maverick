import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { get } from '../lib/api.js';
import { Avatar, Badge, Icon, Menu } from './ui.jsx';
import { money, num } from '../lib/format.js';

/* ------------------------------------------------------------------ */
/* Navigation model                                                    */
/* ------------------------------------------------------------------ */
const TEAM_NAV = [
  {
    group: 'Billing',
    items: [
      { to: '/app', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/app/subscriptions', label: 'Subscriptions', icon: 'refresh' },
      { to: '/app/invoices', label: 'Invoices', icon: 'receipt' },
      { to: '/app/payments', label: 'Payments', icon: 'card' },
      { to: '/app/billing', label: 'Billing runs', icon: 'zap' },
      { to: '/app/reports', label: 'Reports', icon: 'chart' },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { to: '/app/products', label: 'Products', icon: 'box' },
      { to: '/app/plans', label: 'Plans', icon: 'layers' },
      { to: '/app/taxes', label: 'Taxes', icon: 'percent' },
      { to: '/app/templates', label: 'Quotation templates', icon: 'file' },
      { to: '/app/discounts', label: 'Discounts', icon: 'tag' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/app/customers', label: 'Customers', icon: 'users' },
      { to: '/app/team', label: 'Team & access', icon: 'shield', adminOnly: true },
      { to: '/app/mail', label: 'Email log', icon: 'mail' },
      { to: '/app/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const CUSTOMER_NAV = [
  {
    group: 'My account',
    items: [
      { to: '/portal', label: 'Overview', icon: 'dashboard', end: true },
      { to: '/portal/plans', label: 'Browse plans', icon: 'layers' },
      { to: '/portal/subscriptions', label: 'Subscriptions', icon: 'refresh' },
      { to: '/portal/invoices', label: 'Invoices', icon: 'receipt' },
      { to: '/portal/payments', label: 'Payments', icon: 'card' },
      { to: '/portal/profile', label: 'Profile & security', icon: 'user' },
    ],
  },
];

/* ------------------------------------------------------------------ */
export default function Layout() {
  const { user, settings, logout, isAdmin, isCustomer } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const symbol = settings?.currency_symbol || '₹';

  const nav = useMemo(() => {
    const source = isCustomer ? CUSTOMER_NAV : TEAM_NAV;
    return source.map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.adminOnly || isAdmin),
    }));
  }, [isCustomer, isAdmin]);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!isCustomer) setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCustomer]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const currentLabel = useMemo(() => {
    for (const g of nav) for (const i of g.items) {
      if (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)) return i.label;
    }
    if (location.pathname.includes('/subscriptions/')) return 'Subscription';
    if (location.pathname.includes('/invoices/')) return 'Invoice';
    if (location.pathname.includes('/customers/')) return 'Customer';
    return 'Brightloop';
  }, [location.pathname, nav]);

  return (
    <div className="min-h-full flex bg-ink-50">
      {/* ---------------- Sidebar ---------------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[264px] bg-ink-950 text-ink-300 flex flex-col transition-transform duration-200 lg:translate-x-0 no-print
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-white/5 shrink-0">
          <Logo />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-white tracking-tight leading-none">Brightloop</div>
            <div className="text-[10.5px] text-ink-400 mt-1 tracking-wide uppercase">Subscription Suite</div>
          </div>
          <button className="ml-auto lg:hidden text-ink-400" onClick={() => setMobileOpen(false)}>
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {nav.map((group) => (
            <div key={group.group}>
              <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{group.group}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-all
                       ${isActive
                        ? 'bg-brand-600 text-white shadow-[0_2px_10px_-2px_rgba(79,70,229,.7)]'
                        : 'text-ink-300 hover:bg-white/[.06] hover:text-white'}`
                    }
                  >
                    <Icon name={item.icon} className="w-[17px] h-[17px] opacity-90" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-white/5 shrink-0">
          <div className="rounded-xl bg-white/[.04] p-3">
            <div className="flex items-center gap-2 text-[11px] text-ink-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              API connected · SQLite
            </div>
            <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
              Recurring billing runs automatically each day while the server is up.
            </p>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* ---------------- Main ---------------- */}
      <div className="flex-1 lg:pl-[264px] min-w-0 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-16 bg-white/85 backdrop-blur-md border-b border-ink-200/70 flex items-center gap-3 px-4 sm:px-6 no-print">
          <button className="lg:hidden p-2 -ml-2 text-ink-500 hover:text-ink-900" onClick={() => setMobileOpen(true)}>
            <Icon name="list" className="w-5 h-5" />
          </button>

          <div className="hidden sm:flex items-center gap-1.5 text-[13px] text-ink-400">
            <span>{isCustomer ? 'Portal' : 'Workspace'}</span>
            <Icon name="chevronRight" className="w-3.5 h-3.5" />
            <span className="font-medium text-ink-800">{currentLabel}</span>
          </div>

          <div className="flex-1" />

          {!isCustomer && (
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-2 h-9 w-64 rounded-lg border border-ink-200 bg-ink-50/70 px-3 text-[13px] text-ink-400 hover:bg-white hover:border-ink-300 transition"
            >
              <Icon name="search" className="w-4 h-4" />
              <span>Search anything…</span>
              <kbd className="ml-auto text-[10px] font-mono bg-white border border-ink-200 rounded px-1.5 py-0.5 text-ink-400">⌘K</kbd>
            </button>
          )}

          <Link to={isCustomer ? '/portal/invoices' : '/app/invoices'} className="relative p-2 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900" title="Invoices">
            <Icon name="receipt" className="w-[18px] h-[18px]" />
          </Link>

          <Menu
            trigger={
              <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-ink-100 transition">
                <Avatar name={user?.name} size="sm" />
                <div className="hidden sm:block text-left leading-tight">
                  <div className="text-[13px] font-semibold text-ink-900 max-w-[130px] truncate">{user?.name}</div>
                  <div className="text-[11px] text-ink-500 capitalize">{user?.role}</div>
                </div>
                <Icon name="chevronDown" className="w-3.5 h-3.5 text-ink-400" />
              </button>
            }
            items={[
              { label: 'My profile', icon: 'user', onClick: () => navigate(isCustomer ? '/portal/profile' : '/app/settings') },
              { divider: true },
              { label: 'Sign out', icon: 'logout', danger: true, onClick: handleLogout },
            ]}
          />
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1500px] w-full mx-auto">
          <Outlet />
        </main>

        <footer className="px-6 py-4 text-[11.5px] text-ink-400 border-t border-ink-200/60 flex flex-wrap gap-x-4 gap-y-1 justify-between no-print">
          <span>© {new Date().getFullYear()} {settings?.company_name || 'Brightloop Software'}</span>
          <span className="tabular">{symbol} amounts shown in {settings?.currency || 'INR'}</span>
        </footer>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} symbol={symbol} />}
    </div>
  );
}

function Logo() {
  return (
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-900/40 shrink-0">
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round">
        <path d="M6 18V6h6.5a3.5 3.5 0 0 1 0 7H6" />
        <circle cx="17" cy="8" r="2" fill="#c7d2fe" stroke="none" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Command-palette style global search                                 */
/* ------------------------------------------------------------------ */
function GlobalSearch({ onClose, symbol }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    setLoading(true);
    const t = setTimeout(() => {
      get('/search', { q })
        .then(setRes)
        .catch(() => setRes(null))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = (path) => { onClose(); navigate(path); };
  const hasResults = res && (res.subscriptions.length || res.invoices.length || res.customers.length);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-ink-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-pop animate-scale-in overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-ink-100">
          <Icon name="search" className="w-4.5 h-4.5 text-ink-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subscriptions, invoices, customers…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-ink-400"
          />
          {loading && <span className="text-[11px] text-ink-400">…</span>}
          <kbd className="text-[10px] font-mono bg-ink-100 border border-ink-200 rounded px-1.5 py-0.5 text-ink-400">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {!res && (
            <div className="px-4 py-8 text-center text-[13px] text-ink-400">
              Type at least two characters to search.
            </div>
          )}
          {res && !hasResults && (
            <div className="px-4 py-8 text-center text-[13px] text-ink-400">No matches for “{q}”.</div>
          )}

          {res?.subscriptions?.length > 0 && <Group title="Subscriptions">
            {res.subscriptions.map((s) => (
              <Row key={s.id} onClick={() => go(`/app/subscriptions/${s.id}`)} icon="refresh"
                title={s.number} meta={s.customer_name} right={<Badge tone={s.state === 'active' ? 'green' : 'ink'}>{s.state}</Badge>} />
            ))}
          </Group>}

          {res?.invoices?.length > 0 && <Group title="Invoices">
            {res.invoices.map((s) => (
              <Row key={s.id} onClick={() => go(`/app/invoices/${s.id}`)} icon="receipt"
                title={s.number} meta={s.customer_name} right={<span className="tabular text-[12px] text-ink-600">{money(s.total, symbol)}</span>} />
            ))}
          </Group>}

          {res?.customers?.length > 0 && <Group title="Customers">
            {res.customers.map((s) => (
              <Row key={s.id} onClick={() => go(`/app/customers/${s.id}`)} icon="building"
                title={s.company_name || s.name} meta={s.email} />
            ))}
          </Group>}
        </div>
      </div>
    </div>
  );
}

const Group = ({ title, children }) => (
  <div className="py-1">
    <div className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">{title}</div>
    {children}
  </div>
);

const Row = ({ onClick, icon, title, meta, right }) => (
  <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-ink-50 text-left">
    <span className="w-7 h-7 rounded-lg bg-ink-100 text-ink-500 flex items-center justify-center shrink-0">
      <Icon name={icon} className="w-3.5 h-3.5" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[13px] font-medium text-ink-900 truncate">{title}</span>
      <span className="block text-[11.5px] text-ink-500 truncate">{meta}</span>
    </span>
    {right}
  </button>
);
