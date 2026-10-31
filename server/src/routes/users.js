import { Router } from 'express';
import { db } from '../db.js';
import {
  adminOnly, authenticate, hashPassword, internalOnly, isEmail, publicUser, requireRole, validatePassword,
} from '../lib/auth.js';
import { bad, logActivity, notFound, paged, parsePaging, requireFields, ApiError } from '../lib/util.js';

const router = Router();
router.use(authenticate);

/* ------------------------------------------------------------------ */
/* GET /api/users — admin sees everyone, staff sees customers only     */
/* ------------------------------------------------------------------ */
router.get('/', internalOnly, (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query, 25);
    const q = (req.query.q || '').trim();
    const role = req.query.role;
    const isActive = req.query.active;

    const where = [];
    const params = [];
    if (q) {
      where.push('(name LIKE ? OR email LIKE ? OR company_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (role) { where.push('role = ?'); params.push(role); }
    if (isActive !== undefined && isActive !== '') { where.push('is_active = ?'); params.push(isActive === 'true' || isActive === '1' ? 1 : 0); }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM users ${w}`).get(...params).c;
    const rows = db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id = u.id AND s.state = 'active') AS active_subs,
                (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.customer_id = u.id AND i.state != 'cancelled') AS lifetime_invoiced,
                (SELECT COALESCE(SUM(i.balance),0) FROM invoices i WHERE i.customer_id = u.id AND i.state IN ('confirmed') ) AS outstanding
           FROM users u ${w}
          ORDER BY u.created_at DESC
          LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json(paged(rows.map(publicUser), total, page, limit));
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* POST /api/users/staff — ONLY the admin may add staff                */
/* ------------------------------------------------------------------ */
router.post('/staff', adminOnly, (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body || {};
    requireFields(req.body, ['email', 'password', 'name']);
    if (!isEmail(email)) throw bad('Please enter a valid email address.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim())) {
      throw new ApiError(409, 'An account with this email already exists.');
    }
    const pwErrors = validatePassword(password);
    if (pwErrors.length) throw bad('Password does not meet the policy.', { password: pwErrors });

    const info = db.prepare(
      `INSERT INTO users (email, password_hash, name, role, phone, must_reset)
       VALUES (?,?,?,'staff',?,1)`
    ).run(String(email).trim().toLowerCase(), hashPassword(password), name.trim(), phone || null);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    logActivity(req.user, 'user.create_staff', 'user', user.id, `Staff member ${user.email} created`);
    res.status(201).json({ user: publicUser(user) });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* GET /api/users/:id                                                  */
/* ------------------------------------------------------------------ */
router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.user.role === 'customer' && req.user.id !== id) throw new ApiError(403, 'You can only view your own profile.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User not found');
    const stats = {
      subscriptions: db.prepare('SELECT COUNT(*) c FROM subscriptions WHERE customer_id = ?').get(id).c,
      active_subscriptions: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE customer_id = ? AND state='active'").get(id).c,
      invoices: db.prepare('SELECT COUNT(*) c FROM invoices WHERE customer_id = ?').get(id).c,
      outstanding: db.prepare("SELECT COALESCE(SUM(balance),0) s FROM invoices WHERE customer_id = ? AND state='confirmed'").get(id).s,
      paid: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE customer_id = ?").get(id).s,
    };
    res.json({ user: publicUser(user), stats });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* PATCH /api/users/:id — self-service profile, or admin editing       */
/* ------------------------------------------------------------------ */
router.patch('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isSelf = req.user.id === id;
    if (!isSelf && req.user.role !== 'admin') throw new ApiError(403, 'You can only edit your own profile.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User not found');

    const allowedSelf = ['name', 'phone', 'address', 'city', 'country', 'company_name', 'tax_id'];
    const allowedAdmin = [...allowedSelf, 'role', 'is_active'];
    const allowed = req.user.role === 'admin' ? allowedAdmin : allowedSelf;

    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = ?`); params.push(req.body[key]); }
    }
    if (!sets.length) throw bad('Nothing to update.');
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);

    // An admin must not be able to lock themselves out.
    if (id === req.user.id && req.body.is_active === 0) {
      throw bad('You cannot deactivate your own account.');
    }
    logActivity(req.user, 'user.update', 'user', id, `Updated ${user.email}`);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------ */
/* POST /api/users/:id/reset-password — admin forces a new password     */
/* ------------------------------------------------------------------ */
router.post('/:id/reset-password', adminOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { password } = req.body || {};
    requireFields(req.body, ['password']);
    const pwErrors = validatePassword(password);
    if (pwErrors.length) throw bad('Password does not meet the policy.', { password: pwErrors });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User not found');
    db.prepare("UPDATE users SET password_hash = ?, must_reset = 1, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(password), id);
    logActivity(req.user, 'user.reset_password', 'user', id, `Password reset for ${user.email}`);
    res.json({ message: 'Password reset.' });
  } catch (e) { next(e); }
});

export default router;
