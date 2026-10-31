import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

import { db, migrate, getSetting, syncCounters } from './db.js';
import { authenticate } from './lib/auth.js';
import { runBillingSweep } from './lib/billing.js';
import { ApiError } from './lib/util.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import catalogueRoutes from './routes/catalogue.js';
import subscriptionRoutes from './routes/subscriptions.js';
import invoiceRoutes from './routes/invoices.js';
import paymentRoutes from './routes/payments.js';
import discountRoutes from './routes/discounts.js';
import billingRoutes from './routes/billing.js';
import reportRoutes from './routes/reports.js';
import miscRoutes from './routes/misc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);

migrate();
syncCounters();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/* ---- Simple in-memory rate limit on auth endpoints (brute-force guard) ---- */
const hits = new Map();
app.use('/api/auth', (req, res, next) => {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const rec = hits.get(key) || { count: 0, reset: now + 60_000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60_000; }
  rec.count += 1;
  hits.set(key, rec);
  if (rec.count > 40) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
  next();
});

/* ---- Health & meta ------------------------------------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'brightloop-sms',
    time: new Date().toISOString(),
    database: 'sqlite',
    counts: {
      users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      subscriptions: db.prepare('SELECT COUNT(*) c FROM subscriptions').get().c,
      invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c,
    },
  });
});

/* ---- Routes -------------------------------------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', catalogueRoutes);        // /products /plans /taxes /quotation-templates
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/discounts', discountRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', miscRoutes);             // /settings /mail /activity /search /portal/*

/* ---- Optional: serve the built client from the same process -------------- */
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

/* ---- 404 + error handling ------------------------------------------------ */
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'That record already exists (duplicate value).' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Something went wrong on our side.' });
});

/* ======================================================================== */
/* Daily scheduler: the "nobody has to remember" part of the brief.          */
/* Runs the billing sweep once a day while the server is up.                */
/* ======================================================================== */
let schedulerTimer = null;
function startScheduler() {
  if (getSetting('scheduler_enabled', '1') !== '1') {
    console.log('[scheduler] disabled in settings');
    return;
  }
  const tick = () => {
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const ranToday = db.prepare(
        "SELECT COUNT(*) c FROM billing_runs WHERE trigger_source='scheduler' AND as_of_date = ?"
      ).get(today).c;
      if (ranToday) return;
      const dueCount = db.prepare(
        "SELECT COUNT(*) c FROM subscriptions WHERE state='active' AND next_billing_date IS NOT NULL AND next_billing_date <= ?"
      ).get(today).c;
      if (!dueCount) return;
      console.log(`[scheduler] ${dueCount} subscription(s) due — running billing sweep`);
      const res = runBillingSweep({ asOf: today, trigger: 'scheduler' });
      console.log(`[scheduler] created ${res.created} invoice(s) worth ${res.totalAmount}`);
    } catch (e) {
      console.error('[scheduler] failed:', e.message);
    }
  };
  setTimeout(tick, 8000);                    // shortly after boot
  schedulerTimer = setInterval(tick, 6 * 60 * 60 * 1000); // then every 6h
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Brightloop Subscription Management System`);
  console.log(`  API ready at http://localhost:${PORT}/api`);
  console.log(`  Health:     http://localhost:${PORT}/api/health\n`);
  startScheduler();
});

const shutdown = () => {
  if (schedulerTimer) clearInterval(schedulerTimer);
  server.close(() => { try { db.close(); } catch { /* noop */ } process.exit(0); });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
