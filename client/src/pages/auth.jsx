import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { post } from '../lib/api.js';
import { Field, Icon, Input, Spinner } from '../components/ui.jsx';

/* Shared split-screen shell for every auth screen. */
function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex bg-white">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col w-[46%] max-w-[560px] bg-ink-950 relative overflow-hidden p-10">
        <div className="absolute inset-0 opacity-70"
          style={{ background: 'radial-gradient(1000px 600px at 10% 0%, rgba(99,102,241,.45), transparent 60%), radial-gradient(800px 500px at 90% 100%, rgba(139,92,246,.35), transparent 60%)' }} />
        <div className="absolute inset-0 opacity-[.06]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round">
              <path d="M6 18V6h6.5a3.5 3.5 0 0 1 0 7H6" />
              <circle cx="17" cy="8" r="2" fill="#c7d2fe" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-white leading-none">Brightloop</div>
            <div className="text-[10.5px] text-ink-400 mt-1 uppercase tracking-wide">Subscription Suite</div>
          </div>
        </div>

        <div className="relative z-10 mt-auto">
          <h2 className="text-[30px] leading-[1.15] font-semibold text-white tracking-tight">
            Every plan, invoice and payment<br />in one place.
          </h2>
          <p className="mt-3 text-[14px] text-ink-300 max-w-md leading-relaxed">
            Brightloop runs the full life of a subscription business — from launching a plan to
            collecting the money and reporting recurring revenue, without a spreadsheet in sight.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            {[
              ['Recurring billing', 'Automatic, never double-billed'],
              ['Invoicing & tax', 'Rules applied on every line'],
              ['Payments', 'Matched against the right invoice'],
              ['Revenue insights', 'MRR, ageing and forecasts'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl bg-white/[.06] border border-white/10 p-3">
                <div className="text-[12.5px] font-semibold text-white">{t}</div>
                <div className="text-[11.5px] text-ink-400 mt-0.5 leading-snug">{d}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 mt-10 text-[11px] text-ink-500">© {new Date().getFullYear()} Brightloop Software Pvt. Ltd.</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col">
        <div className="lg:hidden h-16 flex items-center gap-2.5 px-6 border-b border-ink-100">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 18V6h6.5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <span className="font-semibold text-ink-900">Brightloop</span>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px] animate-fade-in">
            <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">{title}</h1>
            <p className="text-[14px] text-ink-500 mt-1.5">{subtitle}</p>
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-6 text-[13px] text-ink-500 text-center">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Password strength meter + live policy checklist                     */
/* ------------------------------------------------------------------ */
export function PasswordRules({ password }) {
  const rules = [
    { id: 'len', label: 'More than 8 characters', ok: password.length > 8 },
    { id: 'upper', label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
    { id: 'lower', label: 'One lowercase letter', ok: /[a-z]/.test(password) },
    { id: 'special', label: 'One special character', ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = rules.filter((r) => r.ok).length;
  const bar = ['bg-rose-400', 'bg-amber-400', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-500'][score];

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? bar : 'bg-ink-200'}`} />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        {rules.map((r) => (
          <li key={r.id} className={`flex items-center gap-1.5 text-[11.5px] ${r.ok ? 'text-emerald-600' : 'text-ink-400'}`}>
            <Icon name={r.ok ? 'check' : 'close'} className="w-3 h-3 shrink-0" strokeWidth={2.6} />
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const user = await login(form.email.trim(), form.password);
      navigate(user.role === 'customer' ? '/portal' : '/app');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const demo = (email, password) => () => { setForm({ email, password }); setError(''); };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Pick up where the billing month left off."
      footer={<>New to Brightloop? <Link to="/signup" className="link">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email" required>
          <Input type="email" autoComplete="email" placeholder="you@company.com" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus />
        </Field>

        <Field label="Password" required>
          <div className="relative">
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="•••••••••"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className="pr-10" />
            <button type="button" onClick={() => setShow(!show)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 p-1" aria-label="Toggle password">
              <Icon name={show ? 'eyeOff' : 'eye'} className="w-4 h-4" />
            </button>
          </div>
        </Field>

        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2 flex items-start gap-2">
            <Icon name="alert" className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[13px] link">Forgot your password?</Link>
        </div>

        <button type="submit" className="btn-primary w-full h-10" disabled={busy}>
          {busy ? <Spinner className="w-4 h-4" /> : null} {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-7">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-ink-200" />
          <span className="text-[11px] uppercase tracking-wider text-ink-400 font-medium">Demo accounts</span>
          <div className="h-px flex-1 bg-ink-200" />
        </div>
        <div className="mt-3 space-y-1.5">
          {[
            ['Admin — full access', 'admin@brightloop.io', 'Admin@1234', 'shield'],
            ['Staff — day-to-day', 'priya@brightloop.io', 'Staff@1234', 'user'],
            ['Customer — portal', 'nandini@anandtraders.com', 'Customer@1234', 'building'],
          ].map(([label, email, pw, icon]) => (
            <button key={email} type="button" onClick={demo(email, pw)}
              className="w-full flex items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2 text-left hover:bg-ink-50 hover:border-ink-300 transition group">
              <span className="w-7 h-7 rounded-md bg-ink-100 text-ink-500 group-hover:bg-brand-50 group-hover:text-brand-600 flex items-center justify-center shrink-0">
                <Icon name={icon} className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink-800">{label}</span>
                <span className="block text-[11px] text-ink-400 font-mono truncate">{email}</span>
              </span>
              <span className="text-[10.5px] text-ink-300 group-hover:text-brand-500 font-medium">Use</span>
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Signup                                                              */
/* ------------------------------------------------------------------ */
export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', company_name: '', phone: '', password: '', confirm: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const valid = useMemo(() => (
    form.password.length > 8 && /[A-Z]/.test(form.password) && /[a-z]/.test(form.password)
    && /[^A-Za-z0-9]/.test(form.password) && form.password === form.confirm
  ), [form.password, form.confirm]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setFieldErrors({});
    if (!valid) { setError('Please satisfy the password policy and make sure both passwords match.'); return; }
    setBusy(true);
    try {
      const user = await signup({
        name: form.name.trim(), email: form.email.trim(), password: form.password,
        company_name: form.company_name.trim() || undefined, phone: form.phone.trim() || undefined,
      });
      navigate(user.role === 'customer' ? '/portal' : '/app');
    } catch (err) {
      setError(err.message);
      if (err.details?.password) setFieldErrors({ password: err.details.password.join(' ') });
    } finally { setBusy(false); }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account per email. You'll be able to manage plans, invoices and payments right away."
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nandini Anand" required />
          </Field>
          <Field label="Company">
            <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Anand Traders" />
          </Field>
        </div>

        <Field label="Work email" required hint="Each email can belong to only one account.">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" required />
        </Field>

        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98400 00000" />
        </Field>

        <Field label="Password" required error={fieldErrors.password}>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="•••••••••" required />
          <PasswordRules password={form.password} />
        </Field>

        <Field label="Confirm password" required
          error={form.confirm && form.password !== form.confirm ? 'Passwords do not match.' : ''}>
          <Input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} placeholder="•••••••••" required />
        </Field>

        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2 flex items-start gap-2">
            <Icon name="alert" className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full h-10" disabled={busy}>
          {busy ? <Spinner className="w-4 h-4" /> : null} {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                     */
/* ------------------------------------------------------------------ */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await post('/auth/forgot-password', { email: email.trim() });
      setSent(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send a reset link that stays valid for 60 minutes."
      footer={<Link to="/login" className="link">Back to sign in</Link>}
    >
      {sent ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-emerald-800 font-medium text-[13.5px]">
              <Icon name="checkCircle" className="w-4 h-4" /> Reset link generated
            </div>
            <p className="text-[13px] text-emerald-700 mt-1.5 leading-relaxed">{sent.message}</p>
          </div>

          {sent.dev_link && (
            <div className="rounded-xl border border-ink-200 bg-ink-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Development mode</div>
              <p className="text-[12.5px] text-ink-600 mt-1">No SMTP is configured, so the email is written to the in-app Email log. Use the link below:</p>
              <Link to={sent.dev_link.replace(/^https?:\/\/[^/]+/, '')} className="mt-2 block text-[12px] font-mono break-all text-brand-600 hover:underline">
                {sent.dev_link}
              </Link>
            </div>
          )}

          <button className="btn-secondary w-full" onClick={() => setSent(null)}>Use a different email</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email address" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus />
          </Field>
          {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
          <button className="btn-primary w-full h-10" disabled={busy}>
            {busy ? <Spinner className="w-4 h-4" /> : null} Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Reset password                                                      */
/* ------------------------------------------------------------------ */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="Pick something strong — the same rules apply as when you signed up.">
      {!token ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-3 py-2.5">
          This link is missing its reset token. <Link to="/forgot-password" className="underline">Request a new one</Link>.
        </div>
      ) : done ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 text-[13.5px] flex items-center gap-2">
          <Icon name="checkCircle" className="w-4 h-4" /> Password updated. Taking you to sign in…
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="•••••••••" required autoFocus />
            <PasswordRules password={password} />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="•••••••••" required />
          </Field>
          {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3 py-2">{error}</div>}
          <button className="btn-primary w-full h-10" disabled={busy}>
            {busy ? <Spinner className="w-4 h-4" /> : null} Update password
          </button>
        </form>
      )}
    </AuthShell>
  );
}
