import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { ApiError, bad, forbidden } from './util.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'brightloop-dev-secret-change-me';
export const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

/**
 * Password policy from the brief:
 *  - more than eight characters (>8, i.e. at least 9)
 *  - at least one uppercase letter
 *  - at least one lowercase letter
 *  - at least one special character
 */
export function validatePassword(pw) {
  const errors = [];
  if (typeof pw !== 'string' || pw.length <= 8) errors.push('Password must be more than 8 characters long.');
  if (!/[A-Z]/.test(pw || '')) errors.push('Password must contain an uppercase letter.');
  if (!/[a-z]/.test(pw || '')) errors.push('Password must contain a lowercase letter.');
  if (!/[^A-Za-z0-9]/.test(pw || '')) errors.push('Password must contain a special character.');
  return errors;
}

export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

/** Express middleware: verifies the bearer token and attaches req.user. */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active) return next(new ApiError(401, 'Account is inactive or no longer exists'));
    req.user = user;
    next();
  } catch {
    next(new ApiError(401, 'Session expired, please sign in again'));
  }
}

/** Roles: 'admin' | 'staff' | 'customer'. Admin always passes. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'Authentication required'));
  if (req.user.role === 'admin') return next();
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const adminOnly = requireRole('admin');
export const internalOnly = requireRole('admin', 'staff');

/** Customers may only ever touch their own records. */
export function assertOwner(user, ownerId) {
  if (!user) throw new ApiError(401, 'Authentication required');
  if (user.role === 'customer' && Number(user.id) !== Number(ownerId)) throw forbidden();
}

export { crypto };
