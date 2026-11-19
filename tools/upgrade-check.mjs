// Upgrade check: fills the app's storage with realistic data from the previous version
// (v1–v5 shapes: old "light" days, a 3–5 block, home sessions, pull-ups, v5 bodyweight entries and
// "ate before training?"), starts the current
// app on top of it, and checks nothing was lost or changed.
// Run: node tools/upgrade-check.mjs  (needs Microsoft Edge or Google Chrome)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../js/logic.js';
import { newItem } from '../js/home.js';
import { pullupState, newPullupRecord } from '../js/pullups.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8097;
const ORIGIN = `http://localhost:${PORT}`;
const BROWSER = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- realistic data in the previous version's format ----------

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
function buildData() {
  let s = { ...L.defaultSettings(), pullups: { max: 7, kg: 0, at: at(2026, 6, 1, 6) }, restSeconds: 240, theme: 'dark', lastExportAt: at(2026, 9, 1) };
  s.gameMode = true; // v5 settings
  s.name = 'Test';
  const W = [];
  let day = 0;
  const date = () => at(2026, 6, 2 + (day += 2));
  // 24 gym workouts (one full 5×5 block); every 6th has pull-ups; some missed reps.
  for (let i = 0; i < 24; i++) {
    const w = L.workoutFromPlan(L.planSession(L.nextSessionIndex(W, s), W, s));
    for (const e of w.lifts) e.groups.forEach((g, gi) => g.sets.forEach((x, si) => { x.done = true; if (i % 5 === 0 && gi === 0 && si === 4) x.reps = 4; }));
    w.date = date();
    w.createdAt = Date.parse(w.date);
    w.notes = i === 3 ? 'Felt strong — "tough" day' : '';
    if (i % 4 !== 3) w.fed = i % 4 !== 1; // v5: yes / no / not set
    if (i % 6 === 2) {
      const rec = newPullupRecord(pullupState(W, s, new Date(w.date)));
      rec.sets.forEach((x) => (x.done = true));
      w.pullups = rec;
    }
    W.push(w);
  }
  // A v1-style "light" day and a v1 deload day, untagged.
  W.push({ id: 'v1-light', kind: 'gym', sessionIndex: 4, date: at(2026, 5, 20), createdAt: Date.parse(at(2026, 5, 20)), lifts: [{ lift: 'squat', type: 'light', deload: false, groups: [{ role: 'work', label: '2×5', weight: 90, target: 5, sets: [{ reps: 5, done: true }, { reps: 5, done: true }] }] }], pullups: { sets: [{ reps: 5, done: true }] } });
  // 3–5 block with tests.
  s = L.startBlock(L.switchBlockNow(s), W, { kind: '3-5', oneRM: { squat: 140, bench: 105, deadlift: 180, ohp: 70 }, startPct: 0.65, stepPct: 0.025 }, new Date(at(2026, 8, 10)));
  for (let i = 0; i < 8; i++) {
    const w = L.workoutFromPlan(L.planSession(L.nextSessionIndex(W, s), W, s));
    for (const e of w.lifts) {
      if (e.type === 'test') e.attempts = [{ weight: e.oneRM, reps: 1, clean: true }, { weight: e.oneRM + 5, reps: 1, clean: false }];
      else e.groups.forEach((g) => g.sets.forEach((x) => (x.done = true)));
      if (e.type === '3x5') e.tough = true;
    }
    w.date = at(2026, 8, 12 + i * 2);
    w.createdAt = Date.parse(w.date);
    W.push(w);
  }
  // Home sessions: v3 style, v4 presets, practice sets with times, pull-ups.
  W.push({ id: 'v3-kb', kind: 'home', date: at(2026, 5, 28, 7), createdAt: Date.parse(at(2026, 5, 28, 7)), swings: { reps: 100, kg: 20 }, getups: { reps: 10, kg: 20 }, minutes: 25, notes: 'old S&S' });
  for (let i = 0; i < 6; i++) {
    const d = at(2026, 9, 1 + i * 3, 7);
    const items = [{ ...newItem('warmup', W), done: true, rounds: 2 }, newItem('swings', W), newItem('getups', W), newItem('press', W), newItem('pistol', W), newItem('plank', W)];
    items[4].variation = 'to box';
    items[4].sets.push({ reps: 3, time: at(2026, 9, 1 + i * 3, 13) });
    const pu = newPullupRecord(pullupState(W, s, new Date(d)));
    pu.sets.forEach((x) => (x.done = true));
    items.push({ move: 'pullups', ...pu });
    W.push({ id: 'h' + i, kind: 'home', date: d, createdAt: Date.parse(d), items, minutes: 30, notes: '' });
  }
  // v5 weekly bodyweight entries.
  for (let i = 0; i < 8; i++) W.push({ id: 'bw' + i, kind: 'bw', date: at(2026, 6, 3 + i * 7, 7), createdAt: Date.parse(at(2026, 6, 3 + i * 7, 7)), kg: 83.4 - i * 0.3 });
  return { settings: s, workouts: W };
}

// ---------- browser ----------

async function launch(profile) {
  const port = 9200 + Math.floor(Math.random() * 300);
  const proc = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url === 'about:blank');
      if (page) return { proc, port, ws: page.webSocketDebuggerUrl };
    } catch {}
    await sleep(200);
  }
  throw new Error('browser did not start');
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) (waiting.get(msg.id)(msg), waiting.delete(msg.id));
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((r) => waiting.set(i, r));
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  return { send, ev, close: () => ws.close() };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

if (!BROWSER) {
  console.log('No Edge/Chrome found');
  process.exit(1);
}
const data = buildData();
const seeded = JSON.stringify(data.workouts);
const server = spawn(process.execPath, [join(HERE, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await sleep(800);
const profile = mkdtempSync(join(tmpdir(), 'sl-upgrade-'));
const b = await launch(profile);
const c = cdp(b.ws);
try {
  await c.send('Page.enable');
  // Put the previous version's data in storage before the app starts.
  await c.send('Page.navigate', { url: ORIGIN + '/manifest.webmanifest' });
  await sleep(1500);
  await c.ev(`(async () => { const db = await import('/js/db.js'); await db.set('settings', ${JSON.stringify(data.settings)}); await db.set('workouts', ${seeded}); return 1; })()`);
  // Start the app.
  await c.send('Page.navigate', { url: ORIGIN + '/' });
  await sleep(2500);
  const home = await c.ev(`({ err: document.body.innerText.includes('went wrong'), h2: document.querySelector('main .card h2')?.textContent || '', block: document.querySelector('.block-line')?.textContent || '' })`);
  check('app starts on the old data', !home.err && !!home.block, JSON.stringify(home));
  const stored = await c.ev(`(async () => { const db = await import('/js/db.js'); return JSON.stringify(await db.get('workouts')); })()`);
  check(`all ${data.workouts.length} workouts kept, unchanged`, stored === seeded);
  const set = await c.ev(`(async () => { const db = await import('/js/db.js'); return await db.get('settings'); })()`);
  check('settings kept (rest timer, pull-ups, blocks, last backup)', set.restSeconds === 240 && set.pullups.max === 7 && set.blocks.length === 2 && set.lastExportAt === data.settings.lastExportAt);
  const hist = await c.ev(`(async () => { document.querySelector('[data-action=tab][data-v=history]').click(); await new Promise(r => setTimeout(r, 200)); return document.querySelectorAll('.hrow').length; })()`);
  check('History lists every workout', hist === data.workouts.length, `${hist} rows`);
  const prof = await c.ev(`(async () => { document.querySelector('[data-action=tab][data-v=profile]').click(); await new Promise(r => setTimeout(r, 200)); return { text: document.querySelector('main').innerText.slice(0, 200), err: document.body.innerText.includes('went wrong') }; })()`);
  check('Profile shows XP from the old workouts', !prof.err && /Level \d+/.test(prof.text) && /[\d,]+ XP/.test(prof.text), prof.text.replace(/\n+/g, ' | ').slice(0, 120));
  const prog = await c.ev(`(async () => { const out = []; document.querySelector('[data-action=tab][data-v=progress]').click(); await new Promise(r => setTimeout(r, 100)); for (const a of ['gym','records','home','pullups','body']) { document.querySelector('[data-action=prog][data-path=progressArea][data-v=' + a + ']').click(); await new Promise(r => setTimeout(r, 100)); out.push(document.body.innerText.includes('went wrong') ? a + ':ERR' : a + ':ok'); } return out.join(' '); })()`);
  check('every Progress section opens', !prog.includes('ERR'), prog);
  const ach = await c.ev(`(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('[data-action=tab][data-v=profile]').click(); await sl(150); const card = [...document.querySelectorAll('section.card')].find((x) => x.querySelector('h3')?.textContent === 'Achievements'); const head = card ? card.querySelector('.card-head').innerText : ''; document.querySelector('[data-action=tab][data-v=achievements]').click(); await sl(200); const rows = document.querySelectorAll('.ach-row').length; const earned = document.querySelectorAll('.ach-row.done').length; return { head, rows, earned, err: document.body.innerText.includes('went wrong') }; })()`);
  check('achievements worked out from the old workouts', !ach.err && ach.rows > 80 && ach.earned > 5, JSON.stringify(ach));
  const tvn = await c.ev(`(async () => { document.querySelector('[data-action=tab][data-v=profile]').click(); await new Promise(r => setTimeout(r, 100)); document.querySelector('[data-action=tab][data-v=history]').click(); await new Promise(r => setTimeout(r, 150)); return document.querySelector('.tvn')?.innerText.split(String.fromCharCode(10)).slice(0, 3).join(' | ') || ''; })()`);
  check('History shows "Then vs now"', /Then vs now/.test(tvn), tvn);
  // Log something new; the old records must stay exactly as they were.
  await c.ev(`(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('[data-action=tab][data-v=home]').click(); await sl(100); document.querySelector('[data-action=home-open]').click(); await sl(100); document.querySelector('[data-action=preset-add][data-v=ss]').click(); await sl(100); document.querySelector('[data-action=wu-done]').click(); await sl(50); document.querySelector('[data-action=home-save]').click(); await sl(500); return 1; })()`);
  const card = await c.ev(`document.querySelector('.finish-card')?.innerText || ''`);
  check('finish card shows XP after a new session', /\+[\d,]+ XP/.test(card), card.split('\n')[0]);
  const after = await c.ev(`(async () => { const db = await import('/js/db.js'); return JSON.stringify(await db.get('workouts')); })()`);
  const parsed = JSON.parse(after);
  check('new session added, old ones untouched', parsed.length === data.workouts.length + 1 && JSON.stringify(parsed.slice(0, data.workouts.length)) === seeded);
} finally {
  c.close();
  b.proc.kill();
  server.kill();
  if (process.platform === 'win32') {
    spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  }
}
const ok = results.every(Boolean);
console.log(ok ? '\nUpgrade check passed.' : '\nUpgrade check FAILED.');
process.exit(ok ? 0 : 1);
