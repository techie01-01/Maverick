import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('docs/screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. Start server instance
console.log('Starting Brightloop server...');
const server = spawn('node', ['server/src/index.js'], {
  stdio: 'ignore',
  env: { ...process.env, PORT: '4000' }
});

for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 300));
  try {
    const res = await fetch('http://127.0.0.1:4000/api/health');
    if (res.ok) break;
  } catch {}
}

const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log('Launching browser with:', chromePath);
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // 1. Login Page
  console.log('Capturing: Login Page');
  await page.goto('http://localhost:4000/login', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, '01-login.png') });

  // 2. Perform Login as Admin
  console.log('Logging in as Admin...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const adminBtn = btns.find(b => b.textContent.includes('Admin'));
    if (adminBtn) adminBtn.click();
  });
  await new Promise(r => setTimeout(r, 300));
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1200));

  // 3. Dashboard
  console.log('Capturing: Dashboard');
  await page.screenshot({ path: path.join(outDir, '02-dashboard.png') });

  // 4. Subscriptions List
  console.log('Capturing: Subscriptions List');
  await page.goto('http://localhost:4000/app/subscriptions', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '03-subscriptions.png') });

  // 5. Subscription Detail
  console.log('Capturing: Subscription Detail');
  await page.goto('http://localhost:4000/app/subscriptions/1', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '04-subscription-detail.png') });

  // 6. Invoices List
  console.log('Capturing: Invoices List');
  await page.goto('http://localhost:4000/app/invoices', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '05-invoices.png') });

  // 7. Invoice Detail
  console.log('Capturing: Invoice Detail');
  await page.goto('http://localhost:4000/app/invoices/1', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '06-invoice-detail.png') });

  // 8. Billing Sweep
  console.log('Capturing: Billing Sweep');
  await page.goto('http://localhost:4000/app/billing', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '07-billing-sweep.png') });

  // 9. Discounts & Simulator
  console.log('Capturing: Discounts & Simulator');
  await page.goto('http://localhost:4000/app/discounts', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '08-discounts.png') });

  // 10. Reports
  console.log('Capturing: Reports & Analytics');
  await page.goto('http://localhost:4000/app/reports', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '09-reports.png') });

  // 11. Catalogue: Products, Plans & Taxes
  console.log('Capturing: Products Catalogue');
  await page.goto('http://localhost:4000/app/products', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '10-products.png') });
  await page.screenshot({ path: path.join(outDir, '10-catalogue.png') });

  console.log('Capturing: Plans');
  await page.goto('http://localhost:4000/app/plans', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '10-plans.png') });

  console.log('Capturing: Taxes');
  await page.goto('http://localhost:4000/app/taxes', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, '10-taxes.png') });

  // 12. Customer Portal
  console.log('Capturing: Customer Portal');
  // Clear storage and sign in as customer
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:4000/login', { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const custBtn = btns.find(b => b.textContent.includes('Customer'));
    if (custBtn) custBtn.click();
  });
  await new Promise(r => setTimeout(r, 300));
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(outDir, '11-customer-portal.png') });

  console.log('All 11 screenshots captured successfully!');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

