import { Router } from 'express';
import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { db, getSetting } from '../db.js';
import {
  adminOnly, authenticate, hashPassword, isEmail, publicUser, signToken, validatePassword,
  verifyPassword, requireRole,
} from '../lib/auth.js';
import { ApiError, bad, logActivity, queueMail, requireFields, today } from '../lib/util.js';

const router = Router();

/* ------------------------------------------------------------------ */
/* POST /api/auth/signup — self-service customer registration          */
/* ------------------------------------------------------------------ */
router.post('/signup', (req, res, next) => {
  try {
    const { email, password, name, company_name, phone, address, city, country } = req.body || {};
    requireFields(req.body, ['email', 'password', 'name']);

    if (!isEmail(email)) throw bad('Please enter a valid email address.');
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
    if (existing) throw new ApiError(409, 'An account with this email already exists.');

    const pwErrors = validatePassword(password);
    if (pwErrors.length) throw bad('Password does not meet the policy.', { password: pwErrors });

    // The very first account to register becomes the admin (bootstrap).
    const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const role = userCount === 0 ? 'admin' : 'customer';

    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, role, company_name, phone, address, city, country)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        email.trim().toLowerCase(), hashPassword(password), name.trim(), role,
        company_name || null, phone || null, address || null, city || null, country || null
      );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    logActivity(user, 'auth.signup', 'user', user.id, `${user.email} registered as ${role}`);

    queueMail({
      to: user.email,
      subject: 'Welcome to Brightloop',
      body: `Hi ${user.name},\n\nYour Brightloop account is ready. You can now browse plans, manage your subscriptions and pay invoices online.\n\n— Brightloop Billing`,
      category: 'welcome',
      meta: { user_id: user.id },
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/login                                                */
/* ------------------------------------------------------------------ */
router.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    requireFields(req.body, ['email', 'password']);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, 'Invalid email or password.');
    }
    if (!user.is_active) throw new ApiError(403, 'This account has been deactivated. Contact your administrator.');
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/me                                                    */
/* ------------------------------------------------------------------ */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user), settings: settingsForClient() });
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/forgot-password                                      */
/* Returns a reset token in dev mode so the flow is testable without   */
/* an SMTP server; the link is always written to the mail outbox too.  */
/* ------------------------------------------------------------------ */
router.post('/forgot-password', (req, res, next) => {
  try {
    const { email } = req.body || {};
    requireFields(req.body, ['email']);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());

    // Always answer 200 so the endpoint cannot be used to enumerate accounts.
    const generic = { message: 'If that email is registered, a reset link is on its way.' };
    if (!user) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    const expires = dayjs().add(60, 'minute').toISOString();
    db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?,?,?)').run(user.id, token, expires);
    const link = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${token}`;

    queueMail({
      to: user.email,
      subject: 'Reset your Brightloop password',
      body: `Hi ${user.name},\n\nUse the link below to choose a new password. It expires in 60 minutes.\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
      category: 'password_reset',
      meta: { user_id: user.id, link },
    });
    logActivity(user, 'auth.forgot_password', 'user', user.id, 'Password reset requested');

    res.json({ ...generic, dev_token: process.env.NODE_ENV === 'production' ? undefined : token, dev_link: process.env.NODE_ENV === 'production' ? undefined : link });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/reset-password                                       */
/* ------------------------------------------------------------------ */
router.post('/reset-password', (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    requireFields(req.body, ['token', 'password']);
    const row = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
    if (!row) throw bad('This reset link is not valid. Please request a new one.');
    if (row.used_at) throw bad('This reset link has already been used.');
    if (dayjs(row.expires_at).isBefore(dayjs())) throw bad('This reset link has expired. Please request a new one.');

    const pwErrors = validatePassword(password);
    if (pwErrors.length) throw bad('Password does not meet the policy.', { password: pwErrors });

    db.prepare('UPDATE users SET password_hash = ?, must_reset = 0, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hashPassword(password), row.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
    logActivity({ id: row.user_id }, 'auth.reset_password', 'user', row.user_id, 'Password reset completed');

    res.json({ message: 'Password updated. You can sign in now.' });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/change-password (signed in)                           */
/* ------------------------------------------------------------------ */
router.post('/change-password', authenticate, (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    requireFields(req.body, ['current_password', 'new_password']);
    if (!verifyPassword(current_password, req.user.password_hash)) throw bad('Your current password is incorrect.');
    const pwErrors = validatePassword(new_password);
    if (pwErrors.length) throw bad('Password does not meet the policy.', { password: pwErrors });
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hashPassword(new_password), req.user.id);
    logActivity(req.user, 'auth.change_password', 'user', req.user.id, 'Password changed');
    res.json({ message: 'Password changed successfully.' });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/password-policy — used live by the signup form        */
/* ------------------------------------------------------------------ */
router.get('/password-policy', (_req, res) => {
  res.json({
    minLength: 9,
    rules: [
      { id: 'length', label: 'More than 8 characters', test: '^(?=.{9,})' },
      { id: 'upper', label: 'One uppercase letter', test: '[A-Z]' },
      { id: 'lower', label: 'One lowercase letter', test: '[a-z]' },
      { id: 'special', label: 'One special character', test: '[^A-Za-z0-9]' },
    ],
  });
});

export function settingsForClient() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export default router;
