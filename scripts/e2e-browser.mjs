#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(BASE)) {
  console.error('usage: node scripts/e2e-browser.mjs <base-url>');
  process.exit(2);
}
const CSV = process.env.CSV ?? path.join(ROOT, 'fixtures', 'members.csv');
const OUT = process.env.OUT ?? path.join(ROOT, 'target', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  try {
    return createRequire(path.join(FRONTEND, 'noop.js'))('playwright-core');
  } catch {
    console.error('playwright-core not found in frontend/node_modules. Run:\n  (cd frontend && npm ci)');
    process.exit(2);
  }
}
const { chromium } = loadPlaywright();

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const p = path.join(cache, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
const workers = [];
const responses = [];
const foreign = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('worker', (w) => workers.push(w.url()));
page.on('response', (r) => responses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] }));
page.on('request', (r) => {
  const u = new URL(r.url());
  if (!['data:', 'blob:'].includes(u.protocol) && u.origin !== new URL(BASE).origin) foreign.push(r.url());
});
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`),
  );
});

try {
  await page.goto(`${BASE}/simple`, { waitUntil: 'networkidle' });
  const bodyText = await page.locator('body').innerText();
  check('page renders (Simple mode)',
    /anonymis/i.test(bodyText) && (await page.locator('input[type=file]').count()) > 0);

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { error: 'no serviceWorker' };
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), 15000)),
    ]);
    return reg ? { script: reg.active?.scriptURL, state: reg.active?.state } : { error: 'not ready in 15s' };
  });
  check('service worker registers and activates', !!sw.script && sw.script.endsWith('/sw.js'), JSON.stringify(sw));

  await page.locator('input[type=file]').first().setInputFiles(CSV);
  await page.getByText('Choose anonymisation').waitFor({ timeout: 60000 });
  check('column chooser shown after upload', true);
  await page.locator('select[aria-label="Anonymisation for member_id"]').selectOption('hash');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: /^Anonymise & download$/ }).click(),
  ]);
  const outPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(outPath);
  const lines = (t) => t.replace(/^﻿/, '').trim().split(/\r?\n/);
  const inRows = lines(fs.readFileSync(CSV, 'utf8'));
  const outRows = lines(fs.readFileSync(outPath, 'utf8'));
  check('pseudonymised file downloaded', fs.statSync(outPath).size > 0, dl.suggestedFilename());
  check('member_id column was hashed', outRows[1].split(',')[0] !== inRows[1].split(',')[0]);
  check('other columns kept (email unchanged)', outRows[1].split(',')[2] === inRows[1].split(',')[2]);
  check('output has the same number of rows', outRows.length === inRows.length, `${outRows.length} rows`);

  const workerUrls = workers.filter((u) => /processing\.worker-.*\.js$/.test(u));
  check('processing worker started', workerUrls.length > 0);
  const wasm = responses.filter((r) => r.url.endsWith('.wasm'));
  check('wasm fetched with 200 and application/wasm',
    wasm.length > 0 && wasm.every((r) => r.status === 200 && r.type === 'application/wasm'),
    wasm.map((r) => `${r.status} ${r.type}`).join('; '));
  const workerResp = responses.filter((r) => /processing\.worker-.*\.js$/.test(r.url));
  check('worker script served as JavaScript',
    workerResp.length > 0 && workerResp.every((r) => r.status === 200 && /javascript/.test(r.type)));

  await page.reload({ waitUntil: 'networkidle' });
  check('page renders again after reload', /anonymis/i.test(await page.locator('body').innerText()));
  check('page is controlled by the service worker after reload',
    await page.evaluate(() => !!navigator.serviceWorker.controller));

  const csp = await page.evaluate(() => window.__csp);
  check('no CSP violation', csp.length === 0, csp.join('; '));
  check('no console errors or warnings', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no request left the origin', foreign.length === 0, foreign.join(', '));
  const bad = responses.filter((r) => r.status >= 400);
  check('no HTTP 4xx/5xx responses', bad.length === 0, bad.map((r) => `${r.status} ${r.url}`).join(', '));
} catch (e) {
  check('run completed without an exception', false, e instanceof Error ? e.message.split('\n')[0] : String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length
  ? `${failed.length} of ${results.length} browser checks failed against ${BASE}`
  : `all ${results.length} browser checks passed against ${BASE}`);
process.exit(failed.length ? 1 : 0);
