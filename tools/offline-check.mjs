// Offline check: proves the app opens with NO server and keeps data after the browser is closed.
// Run: node tools/offline-check.mjs  (needs Microsoft Edge or Google Chrome installed)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8099;
const URL_ = `http://localhost:${PORT}/`;
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const BROWSER = BROWSERS.find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'sl-offline-'));

function startServer() {
  const p = spawn(process.execPath, [join(HERE, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  return p;
}

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(BROWSER, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let last = 'no answer';
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      last = list.map((t) => t.type + ' ' + t.url).join('; ');
      const page = list.find((t) => t.type === 'page' && t.url === 'about:blank');
      if (page) return { proc, port, ws: page.webSocketDebuggerUrl };
    } catch {}
    await sleep(200);
  }
  throw new Error('browser did not start: ' + last + ' | exit=' + proc.exitCode);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    const myId = ++id;
    ws.send(JSON.stringify({ id: myId, method, params }));
    return new Promise((r) => waiting.set(myId, r));
  };
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
    return res.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// Close the whole browser properly (so its data is written to disk), like swiping the app away.
async function quit(b) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${b.port}/json/version`)).json();
    const bc = cdp(v.webSocketDebuggerUrl);
    bc.send('Browser.close');
    await new Promise((r) => (b.proc.exitCode !== null ? r() : b.proc.once('exit', r)));
    bc.close();
  } catch {
    b.proc.kill();
  }
  // Edge on Windows can leave background processes running for this test profile; stop them
  // (only processes using this script's own temporary profile folder).
  if (process.platform === 'win32') {
    const tag = basename(profile);
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  }
  // Wait until the browser has fully let go of its profile folder.
  for (let i = 0; i < 75 && existsSync(join(profile, 'lockfile')); i++) await sleep(200);
  await sleep(1000);
}

async function goto(c, url) {
  await c.send('Page.navigate', { url });
  await sleep(2500);
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
let server = startServer();
await sleep(800);

// --- 1st run: online, install the app and save a workout
let b = await launch();
let c = cdp(b.ws);
await c.send('Page.enable');
await goto(c, URL_);
await c.evaluate(`navigator.serviceWorker.ready.then(() => true)`);
await goto(c, URL_); // reload so the service worker controls the page
const swInfo = await c.evaluate(`(async () => {
  const keys = await caches.keys();
  const n = keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
  return { controlled: !!navigator.serviceWorker.controller, cache: keys[0], files: n };
})()`);
check('service worker installed and controlling the page', swInfo.controlled, JSON.stringify(swInfo));
check('all 13 app files cached', swInfo.files === 13, `${swInfo.files} files`);
await c.evaluate(`(async () => {
  const db = await import('/js/db.js');
  const ws = (await db.get('workouts')) || [];
  ws.push({ id: 'offline-test', kind: 'home', date: new Date().toISOString(), createdAt: Date.now(), swings: { reps: 100, kg: 20 }, getups: { reps: 10, kg: 20 } });
  await db.set('workouts', ws);
  return true;
})()`);
c.close();
await quit(b);

// --- turn the server OFF (like airplane mode) and fully restart the browser
server.kill();
await sleep(800);
let serverDown = false;
try {
  await fetch(URL_);
} catch {
  serverDown = true;
}
check('server is really off', serverDown);

b = await launch();
c = cdp(b.ws);
await c.send('Page.enable');
await goto(c, URL_);
const off = await c.evaluate(`(async () => {
  await new Promise(r => setTimeout(r, 500));
  const db = await import('/js/db.js');
  const ws = (await db.get('workouts')) || [];
  return { title: document.title, home: document.querySelector('.card h2')?.textContent || null, tabs: document.querySelectorAll('.tab').length, saved: ws.some(w => w.id === 'offline-test') };
})()`);
check('app opens with no server/internet', off.title === 'Strength Log' && !!off.home && off.tabs === 4, JSON.stringify(off));
check('data survives closing the app', off.saved);
await c.evaluate(`document.querySelector('[data-action=start]').click(), true`);
await sleep(300);
const logging = await c.evaluate(`document.querySelectorAll('.set').length`);
check('can start logging a workout offline', logging >= 4, `${logging} set buttons`);
c.close();
await quit(b);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
const ok = results.every(Boolean);
console.log(ok ? '\nOffline check passed.' : '\nOffline check FAILED.');
process.exit(ok ? 0 : 1);
