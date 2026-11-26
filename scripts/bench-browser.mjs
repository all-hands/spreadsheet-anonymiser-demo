#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
const OUT = path.join(ROOT, 'target', 'bench');
const SIZE_MB = Number(process.env.SIZE_MB ?? 10);
const RUNS = Number(process.env.RUNS ?? 3);
const PORT = Number(process.env.PORT ?? 14173);

function loadPlaywright() {
  for (const base of [process.cwd(), FRONTEND, ROOT]) {
    try {
      return createRequire(path.join(base, 'noop.js'))('playwright-core');
    } catch {
      /* try next */
    }
  }
  console.error('playwright-core not found. Install it without touching package.json:\n' +
    '  (cd frontend && npm i -D --no-save playwright-core)');
  process.exit(2);
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

function generateCsv(file, mb) {
  if (fs.existsSync(file) && fs.statSync(file).size >= mb * 1e6) return fs.statSync(file).size;
  let s = 12345;
  const rnd = (n) => ((s = (s * 16807) % 2147483647), s % n);
  const F = ['Hazel', 'Robin', 'Fern', 'Wren', 'Iris', 'Linnet', 'Sorrel', 'Finch'];
  const L = ['Dummer', 'Notreal', 'Placeholder', 'Smith', 'Testwell', 'Oconnor', 'Dubois', 'Rossi'];
  const C = ['Bristol', 'Leeds', 'Cardiff', 'Glasgow', 'York'];
  const S = ['active', 'inactive', 'pending'];
  const pad = (n, w) => String(n).padStart(w, '0');
  const fd = fs.openSync(file, 'w');
  let bytes = 0;
  const write = (str) => { fs.writeSync(fd, str); bytes += Buffer.byteLength(str); };
  write('id,first_name,last_name,email,phone,city,dob,iban,notes,status\n');
  for (let i = 0; bytes < mb * 1e6; i++) {
    const f = F[rnd(8)], l = L[rnd(8)];
    write([
      i, f, l, `${f.toLowerCase()}.${l.toLowerCase()}${rnd(1000)}@example.com`,
      `+44 20${rnd(10)} ${pad(rnd(10000000), 7)}`, C[rnd(5)],
      `${1950 + rnd(55)}-${pad(1 + rnd(12), 2)}-${pad(1 + rnd(28), 2)}`,
      `GB${pad(rnd(1000000000), 25)}`, `free text note ${rnd(5000)} about ${f} ${l}`, S[rnd(3)],
    ].join(',') + '\n');
  }
  fs.closeSync(fd);
  return bytes;
}

const HASHED = ['first_name', 'last_name', 'email', 'phone', 'city', 'dob', 'iban'];

function treeRssMiB(rootPid) {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
      .trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Map();
    for (const [pid, ppid] of rows) (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)).push(pid);
    const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
    let total = 0;
    const stack = [rootPid];
    while (stack.length) {
      const p = stack.pop();
      total += rss.get(p) ?? 0;
      stack.push(...(kids.get(p) ?? []));
    }
    return total / 1024;
  } catch {
    return 0;
  }
}

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: FRONTEND, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview did not start (is frontend/dist built?)')), 30000);
    const onData = (d) => { if (/127\.0\.0\.1|localhost/.test(String(d))) { clearTimeout(t); resolve(); } };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (c) => reject(new Error(`vite preview exited early (${c})`)));
  });
  return proc;
}

async function oneRun(browserTag, debugPort, file, bytes) {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: process.env.HEADLESS !== '0',
    args: [`--bench-tag=${browserTag}`, `--remote-debugging-port=${debugPort}`],
  });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const conns = new Map();
  const attach = (t) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const c = { ws, last: 0, open: false, id: 0 };
    ws.onopen = () => { c.open = true; };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.result && typeof m.result.usedSize === 'number') c.last = m.result.usedSize;
    };
    conns.set(t.id, c);
  };
  let peakJs = 0, peakRss = 0, sampling = true;
  const browserPid = Number(execFileSync('pgrep', ['-o', '-f', '--', `--bench-tag=${browserTag}`], { encoding: 'utf8' }).trim());
  const sampler = (async () => {
    while (sampling) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        for (const t of targets) {
          if ((t.type === 'page' || t.type === 'worker') && !conns.has(t.id)) attach(t);
        }
      } catch { /* browser starting or closing */ }
      let total = 0;
      for (const c of conns.values()) {
        if (c.open && c.ws.readyState === 1) c.ws.send(JSON.stringify({ id: ++c.id, method: 'Runtime.getHeapUsage' }));
        total += c.last;
      }
      peakJs = Math.max(peakJs, total);
      peakRss = Math.max(peakRss, treeRssMiB(browserPid));
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const c of conns.values()) c.ws.close();
  })();

  await page.goto(`http://127.0.0.1:${PORT}/simple`, { waitUntil: 'networkidle' });
  const t0 = performance.now();
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.getByText('Choose anonymisation').waitFor({ timeout: 300000 });
  const tParse = performance.now();

  for (const h of HASHED) {
    await page.locator(`select[aria-label="Anonymisation for ${h}"]`).selectOption('hash');
  }
  const tRunStart = performance.now();
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 300000 }),
    page.getByRole('button', { name: /^Anonymise & download$/ }).click(),
  ]);
  const tDone = performance.now();
  const outPath = path.join(OUT, `browser-out-${dl.suggestedFilename()}`);
  await dl.saveAs(outPath);
  const outBytes = fs.statSync(outPath).size;
  fs.rmSync(outPath);

  sampling = false;
  await sampler;
  await browser.close();
  if (errors.length) console.error('page errors:', errors.slice(0, 3));
  const parse = (tParse - t0) / 1000, run = (tDone - tRunStart) / 1000;
  return {
    parse_s: parse, run_s: run, total_s: parse + run,
    mb_per_s_total: bytes / 1e6 / (parse + run),
    mb_per_s_run: bytes / 1e6 / run,
    peak_js_heap_mib: peakJs / 1048576, peak_browser_rss_mib: peakRss, out_bytes: outBytes,
  };
}

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `synthetic-${SIZE_MB}mb-browser.csv`);
const bytes = generateCsv(file, SIZE_MB);
console.log(`input ${file} (${(bytes / 1e6).toFixed(2)} MB), ${RUNS} runs, port ${PORT}`);
if (!fs.existsSync(path.join(FRONTEND, 'dist'))) {
  console.error('frontend/dist missing: cd frontend && npm ci && npm run build:wasm && npx vite build');
  process.exit(2);
}

const preview = await startPreview();
const results = [];
try {
  for (let i = 0; i < RUNS; i++) {
    const r = await oneRun(`anon-bench-${process.pid}-${i}`, 19300 + i, file, bytes);
    results.push(r);
    console.log(`run ${i + 1}: parse ${r.parse_s.toFixed(2)}s  anonymise ${r.run_s.toFixed(2)}s  total ${r.total_s.toFixed(2)}s  ` +
      `${r.mb_per_s_total.toFixed(1)} MB/s  js-heap ${r.peak_js_heap_mib.toFixed(0)} MiB  rss ${r.peak_browser_rss_mib.toFixed(0)} MiB`);
  }
} finally {
  preview.kill('SIGTERM');
}
const med = (k) => results.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
const summary = {
  size_mb: bytes / 1e6, runs: RUNS,
  median: Object.fromEntries(Object.keys(results[0]).map((k) => [k, Number(med(k).toFixed(3))])),
  nfr: { time_under_2s_for_10mb: med('total_s') < 2, throughput_over_10mbps: med('mb_per_s_total') > 10 },
};
console.log(JSON.stringify(summary));
