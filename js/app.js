// Strength Log — screens and interaction.
import * as L from './logic.js';
import * as H from './home.js';
import * as P from './pullups.js';
import * as B from './body.js';
import * as X from './xp.js';
import * as A from './achievements.js';
import * as db from './db.js';

// Keep in step with CACHE_VERSION in sw.js (bump both when releasing changes).
const APP_VERSION = '6.0.0';

const $app = document.getElementById('app');
const $timer = document.getElementById('timer');
const $toast = document.getElementById('toast');

const S = {
  settings: L.defaultSettings(),
  workouts: [],
  draft: null, // new gym workout in progress (saved to the phone as you go)
  edit: null, // copy of a past gym workout being edited
  editDirty: false,
  home: null, // home session being logged or edited
  puSetup: null, // pull-up setup screen values { max, kg, back }
  progressArea: 'gym', // gym | home | pullups
  progressMove: null, // home movement key on the Progress tab
  view: 'home',
  homePick: null, // session picked by hand on Home
  sheet: null, // open bottom sheet
  progressLift: 'squat',
  progressType: 'all',
  blockDraft: null, // values on the block start screen
  achSort: 'easy', // full achievements list: easy | hard | close
  achFilter: 'all', // all | done | todo
  persisted: false,
  updateWorker: null,
};

// ---------------------------------------------------------------- helpers

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const kg = L.fmtKg;
const DAY = 86400000;

function fmtDate(iso, withYear) {
  const d = new Date(iso);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function daysAgo(iso) {
  const d = L.daysBetween(iso, new Date()); // calendar days, same as the rest-day logic
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
/** "Thu 19.11." */
function fmtDue(d) {
  const x = new Date(d);
  const wd = x.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${wd} ${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.`;
}
function liftName(id) {
  return L.LIFT_BY_ID[id]?.name || id;
}
function groupsText(groups) {
  return groups.map((g) => `${g.sets}×${g.target} @ ${kg(g.weight)} kg`).join(' then ');
}
function liftPlanText(l) {
  return l.type === 'test' ? '1RM test' : groupsText(l.groups);
}
function curProgram() {
  return L.programFor(L.currentBlock(S.settings).kind);
}
function blockTag(w) {
  return w.kind === 'gym' ? `<span class="chip">${esc(L.blockLabel(L.blockIdOf(w, S.settings), S.settings))}</span>` : '';
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function gameOn() {
  return S.settings.gameMode !== false;
}
function fmtXp(n) {
  return Math.round(n).toLocaleString('en-US');
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2800);
}

// ---------------------------------------------------------------- saving

const saveWorkouts = () => db.set('workouts', S.workouts);
const saveSettings = () => db.set('settings', S.settings);
let draftT;
function saveDraftSoon() {
  clearTimeout(draftT);
  draftT = setTimeout(() => db.set('draft', S.draft || undefined), 200);
}

// ---------------------------------------------------------------- icons

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  progress: '<path d="M4 19.5h16"/><path d="m5 15 4.5-5 4 3.5L19 7"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
  settings:
    '<path d="M5 6.5h14M5 12h14M5 17.5h14"/><circle cx="9" cy="6.5" r="2" fill="var(--surface)"/><circle cx="15" cy="12" r="2" fill="var(--surface)"/><circle cx="8" cy="17.5" r="2" fill="var(--surface)"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

// ---------------------------------------------------------------- render

function render() {
  const views = {
    home: viewHome,
    history: viewHistory,
    progress: viewProgress,
    settings: viewSettings,
    workout: viewWorkout,
    homesess: viewHomeSession,
    pusetup: viewPullupSetup,
    blockstart: viewBlockStart,
    bw: viewBodyweight,
    profile: viewProfile,
    achievements: viewAchievements,
  };
  if ((S.view === 'profile' || S.view === 'achievements') && !gameOn()) S.view = 'home';
  const showTabs = !['workout', 'homesess', 'pusetup', 'blockstart', 'bw', 'achievements'].includes(S.view);
  $app.className = 'view-' + S.view;
  $app.innerHTML = views[S.view]() + (showTabs ? tabBar() : '') + (S.sheet ? viewSheet() : '');
  keepAwake(S.view === 'workout' && !S.edit && !!S.draft);
  tickTimer();
}

function go(view) {
  S.view = view;
  S.sheet = null;
  render();
  window.scrollTo(0, 0);
}

function tabBar() {
  const tabs = [
    ['home', 'Home'],
    ['history', 'History'],
    ['progress', 'Progress'],
    ...(gameOn() ? [['profile', 'Profile']] : []),
    ['settings', 'Settings'],
  ];
  return `<nav class="tabs">${tabs
    .map(([id, label]) => `<button class="tab ${S.view === id ? 'on' : ''}" data-action="tab" data-v="${id}">${icon(id)}<span>${label}</span></button>`)
    .join('')}</nav>`;
}

// ---------------------------------------------------------------- home

function lastGym() {
  const g = L.sortByDate(S.workouts.filter((w) => w.kind === 'gym'));
  return g[g.length - 1];
}

function needsBackup() {
  if (!S.workouts.length) return false;
  if (S.settings.backupSnoozeUntil && Date.now() < Date.parse(S.settings.backupSnoozeUntil)) return false;
  const last = S.settings.lastExportAt ? Date.parse(S.settings.lastExportAt) : 0;
  const newer = S.workouts.filter((w) => (w.createdAt || Date.parse(w.date)) > last).length;
  if (!newer) return false;
  if (!last) return S.workouts.length >= 3;
  return Date.now() - last > 14 * DAY;
}

function updateBanner() {
  if (!S.updateWorker) return '';
  return `<div class="banner"><p><b>A new version of the app is ready.</b></p>
    <button class="btn primary block" data-action="update-app">Update now</button></div>`;
}

function viewHome() {
  const sc = L.schedule(S.workouts, S.settings);
  const st = L.blockStatus(S.workouts, S.settings);
  const program = st.program;
  const next = sc.next;
  const idx = S.homePick ?? next;
  const last = lastGym();
  const nextName = esc(sc.nextName);

  const backup = needsBackup()
    ? `<div class="banner"><p><b>Time for a backup.</b> ${
        S.settings.lastExportAt ? `Last backup was ${daysAgo(S.settings.lastExportAt)}.` : "You haven't made one yet."
      } It saves all your workouts to a file, in case your phone is lost or reset.</p>
      <div class="btn-row"><button class="btn primary" data-action="export">Back up now</button><button class="btn" data-action="backup-later">Later</button></div></div>`
    : '';

  const resume = S.draft
    ? `<div class="banner"><p><b>Workout in progress:</b> ${esc(L.workoutTitle(S.draft))}, started ${fmtTime(S.draft._startedAt)}.</p>
       <button class="btn primary block big" data-action="resume">Continue workout</button></div>`
    : '';

  const blockLine = `<p class="block-line">${esc(st.text)}</p>`;

  const rest = sc.isRestDay
    ? `<section class="card rest">
        <p class="rest-line"><b>${sc.daysSinceLast <= 0 ? 'Trained today' : 'Rest day'}</b> — next: ${nextName}, due ${fmtDue(sc.due)}</p>
        <button class="link" data-action="home-open" data-v="ss">Optional: home Simple &amp; Sinister ›</button>
      </section>`
    : '';

  // "Show more": the rest of this 6-session cycle plus the next cycle (3–5 block: 6 sessions).
  const moreCount = program.sessions.length === 6 ? 12 - next : 6;
  const ups = S.upMore ? L.schedule(S.workouts, S.settings, new Date(), Math.max(3, moreCount)).upcoming : sc.upcoming;
  const upcoming = `<section class="card">
      <h3>Coming up</h3>
      <div class="upcoming">${ups
        .map(
          (u, i) => `<button class="up-row up-btn" data-action="up-preview" data-v="${i}" data-idx="${u.sessionIndex}" data-date="${u.date.toISOString()}">
            <span class="up-date">${fmtDue(u.date)}</span><span>${esc(u.name)}</span><span class="chev">›</span></button>`
        )
        .join('')}</div>
      <button class="link" data-action="up-more">${S.upMore ? 'Show less' : 'Show more'}</button>
      <p class="why">If you train on each due day, with a rest day in between. Moves with you when you log. Tap one to see it.</p>
    </section>`;

  let main;
  if (st.done) {
    const np = L.programFor(st.next);
    main = `<section class="card">
      <div class="eyebrow">${st.endedManually ? 'Block switched' : 'Block complete'}</div>
      <h2>Next: ${esc(np.name)}</h2>
      <p class="why">${esc(np.about)}</p>
      <button class="btn primary big block" data-action="block-setup">Set up the ${esc(np.name)}</button>
    </section>`;
  } else {
    const plan = L.planSession(idx, S.workouts, S.settings);
    const pos = program.kind === '5x5' ? `#${idx + 1} of ${program.sessions.length}` : esc(L.blockLabel(st.block.id, S.settings));
    let eyebrow, title;
    if (idx !== next) {
      eyebrow = `Picked by you · ${pos}`;
      title = esc(plan.name);
    } else if (sc.isRestDay) {
      eyebrow = `Next workout · due ${fmtDue(sc.due)} · ${pos}`;
      title = esc(plan.name);
    } else {
      eyebrow = pos;
      title = `Today: ${esc(plan.name)}`;
    }
    const lifts = plan.lifts
      .map(
        (l) => `<div class="plan-lift">
          <div class="plan-row"><span class="lift-name">${liftName(l.lift)}</span>
          <span class="plan-sets">${liftPlanText(l)}</span></div>
          ${l.notes.map((n) => `<p class="why">${esc(n)}</p>`).join('')}</div>`
      )
      .join('');
    main = `<section class="card">
      <div class="eyebrow">${eyebrow}</div>
      <h2>${title}</h2>
      ${sc.longBreakNote ? `<p class="note-warn">${esc(sc.longBreakNote)}</p>` : ''}
      ${lifts}
      <div class="plan-lift opt"><div class="plan-row"><span class="lift-name">Pull-ups</span><span class="plan-sets">${esc(pullupLine())}</span></div>
        ${pullupNotes().map((n) => `<p class="why">${esc(n)}</p>`).join('')}</div>
      <button class="btn ${sc.isRestDay ? '' : 'primary'} big block" data-action="start">${
        S.draft ? 'Start a new workout' : sc.isRestDay ? 'Start anyway' : 'Start'
      }</button>
      <div class="row-links">
        <button class="link" data-action="pick-session">Do a different session</button>
        ${idx !== next ? '<button class="link" data-action="unpick">Back to suggested</button>' : ''}
      </div>
    </section>`;
  }

  return `<header class="top"><h1>Strength Log</h1>${blockLine}</header>
  <main class="wrap">
    ${updateBanner()}${resume}${backup}${
      B.bwDue(S.workouts)
        ? `<div class="banner bw-banner"><p><b>Log your bodyweight.</b> ${
            B.lastBw(S.workouts) ? `Last entry ${daysAgo(B.lastBw(S.workouts).date)}.` : 'Once a week is enough.'
          }</p><button class="btn primary block" data-action="bw-new">Log bodyweight</button></div>`
        : ''
    }${rest}
    ${main}
    ${upcoming}
    <button class="card kb-btn" data-action="home-open">
      <div><div class="k1">New home session</div>
      <div class="k2">Simple &amp; Sinister, press ladders, bodyweight, pull-ups, custom · combine any · doesn't change the gym plan</div></div>
      <span class="chev">›</span>
    </button>
    ${(() => {
      const t = todaysHomes();
      if (!t.length) return '';
      return `<section class="card"><h3>Today's home sessions</h3>${t
        .map(
          (w) => `<button class="up-row up-btn" data-action="home-continue" data-v="${esc(w.id)}">
            <span class="up-date">${fmtTime(w.date)}</span><span>${esc(homeTitle(w))}</span><span class="chev">Continue ›</span></button>`
        )
        .join('')}</section>`;
    })()}
    <p class="muted center small">${
      last
        ? `Last gym session: ${esc(L.workoutTitle(last))} · ${fmtDate(last.date)} (${daysAgo(last.date)})`
        : 'No workouts yet. Tap Start when you get to the gym.'
    }</p>
  </main>`;
}

// ---------------------------------------------------------------- pull-up program

function puState() {
  return P.pullupState(S.workouts, S.settings);
}

function pullupLine(st = puState()) {
  if (st.phase === 'setup') return 'optional · set up the program in Settings';
  if (st.doneToday) return 'done today ✓';
  if (st.dayOff) return 'day off';
  if (st.phase === 'ladder') return `optional · today's ladder: ${st.ladder.join(', ')}`;
  if (st.phase === 'test') return 'max test (after a few rest days)';
  return 'optional · log freely';
}

function pullupNotes(st = puState()) {
  const n = [];
  if (st.phase === 'ladder' && st.missed && !st.doneToday) n.push('Missed reps last time → same ladder until it is done.');
  if (st.phase === 'test' && !st.doneToday) n.push('25 sessions done. Take a few rest days, then test your max.');
  if (st.longBreakNote) n.push(st.longBreakNote);
  return n;
}

function lastFreePullups() {
  const r = P.pullupRecords(S.workouts).filter((x) => x.rec.mode === 'free').pop();
  return r ? r.rec : null;
}

/** Pull-up card, used in gym workouts (where = 'gym') and home sessions (where = item index). */
function pullupCard(rec, where, ownerId) {
  const st = puState();
  const home = where !== 'gym';
  const remove = home
    ? `<button class="link" data-action="item-remove" data-v="${where}">Remove</button>`
    : `<button class="link" data-action="pu-remove">Remove</button>`;
  if (!rec || !rec.mode) {
    if (st.phase === 'setup') {
      return `<section class="card"><div class="card-head"><h3>Pull-ups</h3>${home ? remove : ''}</div>
        <p class="why">Set up your pull-up program first: it asks for your current max.</p>
        <button class="btn block" data-action="pu-setup">Set up the pull-up program</button></section>`;
    }
    return `<button class="add" data-action="pu-add">+ Pull-ups — ${esc(pullupLine(st))}</button>`;
  }
  const pfx = home ? `hp.${where}` : 'p';
  const saved = st.records.find((r) => r.id === ownerId);
  const wontCount = saved ? !saved.counts : st.doneToday;
  const head =
    rec.mode === 'ladder'
      ? `Ladder: ${rec.ladder.join(', ')}${st.phase === 'ladder' && st.progress && !saved ? ` · ${st.progress}` : ''}`
      : rec.mode === 'test'
        ? 'Max test: strict pull-ups, dead hang, full range. Tick the set and set your reps.'
        : 'Log freely — no program.';
  const showKg = rec.mode !== 'ladder' || rec.kg > 0;
  return `<section class="card">
    <div class="card-head"><h3>Pull-ups</h3>${remove}</div>
    <p class="why">${esc(head)}</p>
    ${pullupNotes(st).map((n) => `<p class="why">${esc(n)}</p>`).join('')}
    ${wontCount ? '<p class="note-warn">Pull-ups were already logged today — this one is saved but won\'t count toward the program.</p>' : ''}
    ${showKg ? `<div class="group-head"><span class="glabel">Added weight</span>${stepper(home ? `hk.${where}` : 'pk', rec.kg || 0)}</div>` : ''}
    <div class="sets">${rec.sets.map((s, si) => setBtn(`${pfx}.${si}`, s, rec.ladder ? rec.ladder[si] : null)).join('')}
      ${rec.mode === 'free' ? `<button class="set" data-action="pu-addset" data-v="${where}" aria-label="Add a set">+</button>` : ''}</div>
    ${rec.mode === 'free' ? `<button class="link" data-action="pu-test" data-v="${where}">Log a max test instead</button>` : ''}
  </section>`;
}

function viewPullupSetup() {
  const u = S.puSetup;
  if (!u) return viewHome();
  const p = P.pickProgram(u.max);
  const first = p.base ? p.base.join(', ') : null;
  const mini = (path, val, step, unit) => `<div class="stepper">
      <button class="step" data-action="pus-step" data-path="${path}" data-v="${-step}" aria-label="Less">−</button>
      <span class="big-num">${kg(val)}</span><span class="unit">${unit}</span>
      <button class="step" data-action="pus-step" data-path="${path}" data-v="${step}" aria-label="More">+</button></div>`;
  return `<header class="top bar">
      <button class="btn ghost" data-action="pus-back">‹ Back</button>
      <div class="title"><div class="t">Pull-up program</div><div class="sub">Pavel's Fighter Pullup Program</div></div>
      <span style="width:60px"></span>
    </header>
    <main class="wrap">
      <section class="card">
        <h3>Your current max</h3>
        <p class="why">Strict pull-ups: dead hang, full range.</p>
        <div class="setting-row"><span class="glabel">Max reps</span>${mini('max', u.max, 1, 'reps')}</div>
        <div class="setting-row"><span class="glabel">Added weight (optional)</span>${mini('kg', u.kg, 2.5, 'kg')}</div>
        <p class="why">For strength, Pavel says you can hang weight to bring your reps down to three; the ladders work the same.</p>
      </section>
      <section class="card">
        <div class="eyebrow">Program picked</div>
        <h3>${esc(p.name)}</h3>
        <p class="why">${esc(p.about)}</p>
        ${first ? `<p class="calc">Week 1: 5 sessions, adding ${p.step === 2 ? '2 reps' : '1 rep'} to one more set each session (day off after the 5th) · after 25 sessions, rest a few days and test your max.</p>` : ''}
      </section>
      <button class="btn primary big block" data-action="pus-save">Save and start</button>
    </main>`;
}

// ---------------------------------------------------------------- home sessions

function homeTitle(w) {
  const names = H.homeItems(w).map((it) => (it.move === 'custom' ? it.name || 'Custom' : H.MOVES[it.move]?.name)).filter(Boolean);
  return names.join(', ') || 'Home session';
}

function todaysHomes() {
  const today = L.localDay(new Date()).getTime();
  return L.sortByDate(S.workouts.filter((w) => w.kind === 'home' && L.localDay(w.date).getTime() === today));
}

function addMove(move) {
  const h = S.home;
  if (move !== 'custom' && h.items.some((i) => i.move === move)) return;
  if (move === 'pullups') {
    const st = puState();
    h.items.push(st.phase === 'setup' ? { move } : { move, ...P.newPullupRecord(st, lastFreePullups()) });
    return;
  }
  h.items.push(H.newItem(move, S.workouts, { excludeId: h.id }));
}

function addPreset(id) {
  const p = H.PRESETS.find((x) => x.id === id);
  if (p) p.moves.forEach(addMove);
  S.homeDirty = true;
}

/** Starts a new home session (any number per day), optionally with a preset. */
function openHome(preset) {
  S.home = { id: L.makeId(), kind: 'home', date: null, items: [], minutes: null, notes: '' };
  S.homeBack = 'home';
  S.homeDirty = false;
  if (preset) addPreset(preset);
  go('homesess');
  if (!S.home.items.length) {
    S.sheet = { kind: 'presets' };
    render();
  }
}

/** Opens a saved home session to add to it (e.g. practice sets later the same day). */
function openSavedHome(id, back = 'home') {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return;
  const { swings, getups, ...rest } = clone(w);
  S.home = { ...rest, items: clone(H.homeItems(w)), _editing: true };
  S.homeBack = back;
  S.homeDirty = false;
  go('homesess');
}

function miniStep(action, path, val, step, label) {
  return `<div class="mini"><span class="glabel">${label}</span><div class="stepper">
    <button class="step sm" data-action="${action}" data-path="${path}" data-v="${-step}" aria-label="Less ${label}">−</button>
    <span class="mini-val">${val}</span>
    <button class="step sm" data-action="${action}" data-path="${path}" data-v="${step}" aria-label="More ${label}">+</button></div></div>`;
}

function homeItemCard(it, i) {
  const m = H.MOVES[it.move];
  if (!m) return '';
  if (m.kind === 'pullups') return pullupCard(it, i, S.home._editing ? S.home.id : null);
  const title = m.named
    ? `<input type="text" data-bind="home:items.${i}.name" value="${esc(it.name)}" placeholder="Movement name, e.g. Curls" aria-label="Movement name">`
    : `<h3>${esc(m.name)}${m.per ? ` <span class="small muted">${m.per}</span>` : ''}</h3>`;
  const head = `<div class="card-head">${title}<button class="link" data-action="item-remove" data-v="${i}">Remove</button></div>`;
  const about = m.about && m.kind !== 'ladders' ? `<p class="why">${esc(m.about)}</p>` : '';
  if (m.kind === 'warmup') {
    return `<section class="card">${head}${about}
      <div class="setting-row"><button class="btn ${it.done ? 'good' : ''}" data-action="wu-done" data-v="${i}">${it.done ? '✓ Done' : 'Tick when done'}</button>
      <span class="glabel">Rounds</span><div class="seg rounds">${[1, 2, 3]
        .map((n) => `<button class="${(it.rounds || 1) === n ? 'on' : ''}" data-action="wu-rounds" data-path="${i}" data-v="${n}" aria-label="${n} round${n > 1 ? 's' : ''}">${n}</button>`)
        .join('')}</div></div></section>`;
  }
  const bellStep = ['swings', 'getups', 'press'].includes(it.move) ? 4 : S.settings.rounding || 2.5;
  const kgRow = m.kg
    ? `<div class="group-head"><span class="glabel">${it.move === 'custom' ? 'Weight (optional)' : 'Bell'}</span>${stepper(`hk.${i}`, it.kg || 0)}</div>`
    : '';
  const variation = m.variation
    ? `<input type="text" data-bind="home:items.${i}.variation" value="${esc(it.variation)}" placeholder="Variation, e.g. to box, feet wide, hands elevated" aria-label="Variation">`
    : '';
  if (m.kind === 'ladders') {
    const planned = it.ladders.filter((l) => !l.time);
    const pp = H.pressProgress(S.workouts.filter((w) => w.id !== S.home.id), it.kg);
    const reps = H.ladderReps(it.ladders);
    return `<section class="card">${head}${kgRow}
      <div class="quick">${miniStep('q-sets', i, planned.length, 1, 'Ladders')}${miniStep('q-reps', i, planned[0] ? H.rungText(planned[0].top) : '–', 1, 'Rungs')}</div>
      <div class="chips">${it.ladders
        .map((l, li) => `<button class="chip-set" data-action="hs-edit" data-path="${i}.${li}">${H.rungText(l.top)}${l.time ? `<small>${fmtTime(l.time)}</small>` : ''}</button>`)
        .join('')}</div>
      <button class="btn sm" data-action="hs-add" data-v="${i}">+1 ladder</button>
      <div class="goal">
        <p>This session: <b>${H.ladderText(it.ladders)}</b> = ${reps} reps per arm</p>
        <p>${pp.last ? `Last with ${kg(it.kg)} kg: ${esc(pp.last.text)}` : `No ladders logged with ${kg(it.kg)} kg yet`}</p>
        <p>Goal for this bell: ${pp.goalText} (${pp.goalReps} reps per arm)${pp.reached ? ' — reached ✓' : ''}, then a heavier bell.</p>
        <p>Long-term goal: press the ${H.PRESS_LONG_TERM_KG} kg bell.</p>
      </div>
    </section>`;
  }
  const secs = m.kind === 'secs';
  const key = secs ? 'secs' : 'reps';
  const planned = it.sets.filter((s) => !s.time);
  const step = it.move === 'swings' ? 10 : 1;
  const quick = m.total
    ? `<div class="quick">${miniStep('q-reps', i, planned[0] ? planned[0].reps : '–', step, 'Total reps')}</div>`
    : `<div class="quick">${miniStep('q-sets', i, planned.length, 1, 'Sets')}${miniStep('q-reps', i, planned[0] ? planned[0][key] : '–', 1, secs ? 'Seconds' : 'Reps')}</div>`;
  const dur = m.total
    ? `<div class="dur-row"><span class="glabel">Time (optional)</span>
        <input class="dur-in" type="text" inputmode="numeric" data-hdur="${i}.m" value="${it.durationSec > 0 ? Math.floor(it.durationSec / 60) : ''}" placeholder="min" aria-label="Minutes">
        <span>:</span>
        <input class="dur-in" type="text" inputmode="numeric" data-hdur="${i}.s" value="${it.durationSec > 0 ? String(it.durationSec % 60).padStart(2, '0') : ''}" placeholder="sec" aria-label="Seconds"></div>
      <p class="why">${it.move === 'swings' ? "Pavel's Simple: 100 one-arm swings in 5:00." : "Pavel's Simple: 10 get-ups in 10:00."} Only needed for those achievements.</p>`
    : '';
  return `<section class="card">${head}${about}${variation}${kgRow}${quick}${dur}
    <div class="chips">${it.sets
      .map((s, si) => `<button class="chip-set" data-action="hs-edit" data-path="${i}.${si}">${s[key]}${secs ? 's' : ''}${s.time ? `<small>${fmtTime(s.time)}</small>` : ''}</button>`)
      .join('')}</div>
    <button class="btn sm" data-action="hs-add" data-v="${i}">+1 set (practice, with time)</button>
  </section>`;
}

function viewHomeSession() {
  const h = S.home;
  if (!h) return viewHome();
  const editing = !!h._editing;
  return `<header class="top bar">
      <button class="btn ghost" data-action="home-back">‹ ${S.homeBack === 'history' ? 'Back' : 'Home'}</button>
      <div class="title"><div class="t">Home session</div><div class="sub">${editing ? fmtDate(h.date) + ' · ' + fmtTime(h.date) : 'New'}</div></div>
      <button class="btn primary sm" data-action="home-save">Save</button>
    </header>
    <main class="wrap">
      <p class="hint">Home sessions never change your gym plan.</p>
      ${h.items.map((it, i) => homeItemCard(it, i)).join('')}
      <button class="add" data-action="home-add">+ Add movements</button>
      <section class="card">
        <label class="lbl" for="hmin">Total time (minutes, optional)</label>
        <input id="hmin" type="text" inputmode="decimal" data-bind="home:minutes" data-num value="${h.minutes ?? ''}" placeholder="e.g. 25">
        <label class="lbl" for="hnotes">Notes</label>
        <textarea id="hnotes" data-bind="home:notes" rows="2">${esc(h.notes)}</textarea>
        <label class="lbl" for="hdate">Date &amp; time</label>
        <input id="hdate" type="datetime-local" data-homedate value="${toLocalInput(h.date)}">
      </section>
      <button class="btn primary big block" data-action="home-save">Save session</button>
      ${editing ? '<button class="btn danger block" data-action="home-delete">Delete this session</button>' : ''}
    </main>`;
}

async function saveHome() {
  const h = clone(S.home);
  const editing = !!h._editing;
  h.items = h.items.filter((it) => {
    const m = H.MOVES[it.move];
    if (!m) return false;
    if (m.kind === 'warmup') return it.done;
    if (m.kind === 'pullups') return it.mode && it.sets.some((s) => s.done);
    if (m.kind === 'ladders') return it.ladders.length > 0;
    return it.sets.length > 0;
  });
  for (const it of h.items) if (it.move === 'custom' && !(it.name || '').trim()) it.name = 'Custom';
  if (!h.items.length) return toast('Nothing to save yet — add a set or tick the warm-up');
  if (!editing) {
    h.date = h._dateTouched && h.date ? h.date : new Date().toISOString();
    h.createdAt = Date.now();
  } else h.updatedAt = Date.now();
  for (const k of Object.keys(h)) if (k.startsWith('_')) delete h[k];
  const before = editing ? null : xpSnapshot();
  if (editing) S.workouts = S.workouts.map((x) => (x.id === h.id ? h : x));
  else S.workouts.push(h);
  await saveWorkouts();
  const back = S.homeBack === 'history' ? 'history' : 'home';
  S.home = null;
  S.homeDirty = false;
  go(back);
  toast('Home session saved');
  if (!editing) showFinishCard(h.id, before);
}

// ---------------------------------------------------------------- profile (game layer)

// Level 99 badge (provided by you): shown next to your name once you reach level 99.
const BADGE_99_SRC = 'icons/badge99.webp';

function beltHtml(bi, big) {
  const marks = Array.from({ length: 4 }, (_, i) => `<span class="stripe ${i < bi.stripes ? 'on' : ''}"></span>`).join('');
  const degrees = bi.degrees ? Array.from({ length: bi.degrees }, () => '<span class="degree"></span>').join('') : '';
  return `<div class="belt belt-${bi.belt.id} ${big ? 'big' : ''}" role="img" aria-label="${bi.belt.name} belt, ${bi.stripes} stripe${bi.stripes === 1 ? '' : 's'}${bi.degrees ? `, ${bi.degrees} degree${bi.degrees > 1 ? 's' : ''}` : ''}">
    <span class="belt-tab">${bi.degrees ? degrees : marks}</span></div>`;
}

function xpBar(pct) {
  return `<div class="xpbar"><div class="xpfill" style="width:${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%"></div></div>`;
}

function viewProfile() {
  const led = X.xpLedger(S.workouts, S.settings);
  const li = X.levelInfo(led.total);
  const bi = X.beltInfo(led.total);
  const sc = L.schedule(S.workouts, S.settings);
  const badge = bi.badge99 && BADGE_99_SRC ? `<img class="badge99" src="${BADGE_99_SRC}" alt="Level 99">` : '';
  const stripeTxt = `${bi.stripes} stripe${bi.stripes === 1 ? '' : 's'}`;
  const recent = led.entries.slice(-20).reverse();
  const late = sc.lastDate ? L.daysBetween(sc.due, new Date()) : null;
  let streakNote = 'Your first gym session starts the streak.';
  if (sc.lastDate) {
    if (late < 0) streakNote = `Next session due ${fmtDue(sc.due)} — on that day for the full bonus.`;
    else if (late === 0) streakNote = 'Due today — train today for the full bonus.';
    else if (late === 1) streakNote = 'Due yesterday — today still gives half the bonus and keeps the streak.';
    else streakNote = 'The streak starts again from your next session.';
  }
  return `<header class="top"><h1>Profile</h1></header>
    <main class="wrap">
      <section class="card profile-head">
        <div class="pname">${esc(S.settings.name || 'You')} ${badge}</div>
        ${beltHtml(bi, true)}
        <p><b>${bi.belt.name} belt</b> · ${bi.degrees ? `${bi.degrees} degree${bi.degrees > 1 ? 's' : ''}` : stripeTxt} · <b>Level ${li.level}</b> · ${fmtXp(led.total)} XP</p>
      </section>
      <section class="card">
        <h3>Level ${li.level}</h3>
        ${xpBar(li.pct)}
        <p class="calc">${
          li.to ? `<b>${fmtXp(li.toNext)}</b> XP to level ${li.level + 1}` : 'Level 99 — XP keeps counting'
        }${bi.toNextStripe != null ? ` · <b>${fmtXp(bi.toNextStripe)}</b> XP to the next stripe` : ''}</p>
      </section>
      <section class="card">
        <h3>Belt</h3>
        <p>${bi.belt.name} belt, ${bi.degrees ? `${bi.degrees} degree${bi.degrees > 1 ? 's' : ''}` : stripeTxt}</p>
        <p class="calc">${
          bi.level >= 99
            ? bi.toNextDegree != null
              ? `<b>${fmtXp(bi.toNextDegree)}</b> XP to the next degree (every 4,000,000 XP, up to 6)`
              : 'All 6 degrees earned'
            : `<b>${fmtXp(bi.toNextBelt)}</b> XP to ${bi.nextBelt ? `${bi.nextBelt.name.toLowerCase()} belt (level ${bi.nextBelt.from})` : 'level 99'}`
        }</p>
        <p class="why">White → blue at level 83 → purple 91 → brown 95 → black 98. Four stripes per belt.</p>
      </section>
      <section class="card">
        <h3>On-time streak</h3>
        <p><b>${led.streak}</b> session${led.streak === 1 ? '' : 's'} · bonus <b>+${Math.round(led.bonusPct * 100)}%</b> (max +50%)</p>
        <p class="why">${esc(streakNote)}</p>
      </section>
      ${achievementsCard(led.achievements)}
      <section class="card">
        <h3>Recent XP</h3>
        ${
          recent.length
            ? `<div class="xplist">${recent
                .map(
                  (e) => `<div class="xprow"><div class="xprow-top"><span>${esc(e.label)}</span><b>+${fmtXp(e.total)}</b></div>
                  <div class="why">${fmtDate(e.date)} · ${esc(X.breakdown(e, fmtXp))}${e.timing ? ` · ${esc(e.timing)}` : ''}</div></div>`
                )
                .join('')}</div>`
            : '<p class="muted">Log a session to earn XP.</p>'
        }
      </section>
    </main>`;
}

/** What the game layer looked like before saving (to show what a session added). */
function xpSnapshot() {
  if (!gameOn()) return null;
  const led = X.xpLedger(S.workouts, S.settings);
  return { total: led.total, ach: new Set(led.achievements.filter((a) => a.earned).map((a) => a.def.id)) };
}

/** The small card after finishing a session: XP earned, new achievements and records, level progress. */
function showFinishCard(refId, before) {
  if (!gameOn() || !before) return;
  S.sheet = { kind: 'finish', refId, before };
  render();
}

function finishCardHtml(sh) {
  const led = X.xpLedger(S.workouts, S.settings);
  const mine = X.xpFor(led, sh.refId).filter((e) => e.kind !== 'ach');
  const fresh = led.achievements.filter((a) => a.earned && !sh.before.ach.has(a.def.id));
  const earned = mine.reduce((s, e) => s + e.total, 0) + fresh.reduce((s, a) => s + a.xp, 0);
  // One line per lift and weight: "Deadlift 160 kg — 1, 3 and 5 reps (was 145)".
  const records = [];
  for (const r of A.newRecords(S.workouts, sh.refId)) {
    const g = records.find((x) => x.lift === r.lift && x.weight === r.weight);
    if (g) g.reps.push(r.reps), g.prev.push(r.prev);
    else records.push({ lift: r.lift, weight: r.weight, reps: [r.reps], prev: [r.prev] });
  }
  const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : String(xs[0]));
  const wasTxt = (ps) => {
    const lo = Math.min(...ps);
    const hi = Math.max(...ps);
    return lo === hi ? kg(lo) : `${kg(lo)}–${kg(hi)}`;
  };
  const near = A.closest(led.achievements);
  const li = X.levelInfo(led.total);
  const bi = X.beltInfo(led.total);
  const beforeLv = X.levelForXp(sh.before.total);
  return `<h3>+${fmtXp(earned)} XP</h3>
    ${
      mine
        .map((e) => `<p class="center"><b>${esc(e.label)}</b>: ${esc(X.breakdown(e, fmtXp))}</p>${e.timing && e.kind === 'gym' ? `<p class="why center">${esc(e.timing)}</p>` : ''}`)
        .join('') || (fresh.length ? '' : '<p class="why center">No XP for this one.</p>')
    }
    ${
      fresh.length
        ? `<div class="fc-list">${fresh
            .map((a) => `<div class="fc-ach">${badgeHtml(a, 'sm')}<span><b>${esc(a.def.name)}</b><br><span class="why">${a.tier.name} achievement · +${fmtXp(a.xp)} XP</span></span></div>`)
            .join('')}</div>`
        : ''
    }
    ${
      records.length
        ? `<div class="fc-rec"><div class="glabel">New records</div>${records
            .map((r) => `<p>${esc(L.LIFT_BY_ID[r.lift].short)} <b>${kg(r.weight)} kg</b> — ${andList(r.reps)} rep${r.reps.length > 1 || r.reps[0] > 1 ? 's' : ''} <span class="muted">(was ${wasTxt(r.prev)})</span></p>`)
            .join('')}</div>`
        : ''
    }
    ${li.level > beforeLv ? `<p class="center levelup">Level up! ${beforeLv} → ${li.level}</p>` : ''}
    <p class="center">Level ${li.level} · ${bi.belt.name} belt, ${bi.stripes} stripe${bi.stripes === 1 ? '' : 's'}</p>
    ${xpBar(li.pct)}
    <p class="calc center">${bi.toNextStripe != null ? `${fmtXp(bi.toNextStripe)} XP to the next stripe` : li.to ? `${fmtXp(li.toNext)} XP to level ${li.level + 1}` : ''}</p>
    ${
      near.length
        ? `<div class="fc-near"><div class="glabel">Closest achievements</div>${near
            .map((a) => `<div class="fc-near-row"><span>${esc(a.def.name)}</span><span class="muted">${Math.floor(a.pct * 100)}%</span></div>${xpBar(a.pct)}`)
            .join('')}</div>`
        : ''
    }`;
}

// ---------------------------------------------------------------- achievements (game layer)

const CAT_ICON = {
  ratio: '<path d="M12 4v15M7 19.5h10M5 7.5h14"/><path d="M5 7.5 2.5 13h5zM19 7.5 16.5 13h5z"/>',
  plates: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  total: '<path d="M2.5 12h19M6 8v8M9 6v12M15 6v12M18 8v8"/>',
  program: '<path d="M6 21V4h11l-2.5 4 2.5 4H6"/>',
  consistency: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10.5h16M9 3.5v4M15 3.5v4"/>',
  discipline: '<path d="M12 3.5 19 6.5v5.5c0 4.3-2.9 7.3-7 8.8-4.1-1.5-7-4.5-7-8.8V6.5z"/>',
  pullups: '<path d="M3 4h18M8 4v4.5M16 4v4.5"/><circle cx="12" cy="10.5" r="2"/><path d="M12 12.5v5M9.5 21l2.5-3.5 2.5 3.5"/>',
  kettlebell: '<path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/><circle cx="12" cy="15" r="5.5"/>',
  skills: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M7.5 10h9M12 14l-4 6.5M12 14l4 6.5"/>',
  endurance: '<path d="M4 19c3.5 0 4.5-3.5 6.5-7S14 5 17 5h3"/><circle cx="4" cy="19" r="1.2"/><circle cx="20" cy="5" r="1.2"/>',
  tonnage: '<path d="M7.5 9h9l3 11h-15z"/><circle cx="12" cy="6" r="2.5"/>',
  habits: '<path d="M5 12.5 9.5 17 19 7"/>',
  hidden: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
};

function badgeHtml(a, size = '') {
  const label = `${a.tier.name} badge: ${a.def.name}${a.earned ? '' : ', not earned yet'}`;
  return `<span class="ach-badge t-${a.tier.id} ${a.earned ? '' : 'locked'} ${size}" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    CAT_ICON[a.def.cat] || CAT_ICON.hidden
  }</svg></span>`;
}

function achRow(a, compact) {
  const tierLine = `<span class="ach-tier t-${a.tier.id}">${a.tier.name} · ${fmtXp(a.xp)} XP</span>`;
  // Notes starting with a lowercase word continue the progress text ("90 / 140 kg"); others go on their own line.
  const inline = a.note && /^[a-z]/.test(a.note);
  const state = a.earned
    ? `<p class="ach-earned">✓ Earned ${fmtDate(a.earned.date, true)}</p>`
    : `${xpBar(a.pct)}<p class="calc">${esc(a.text)}${inline ? ` ${esc(a.note)}` : ''} — ${Math.floor(a.pct * 100)}%${
        a.note && !inline ? `<br><span class="muted">${esc(a.note)}</span>` : ''
      }</p>`;
  return `<div class="ach-row ${a.earned ? 'done' : ''}">${badgeHtml(a)}
    <div class="ach-body"><div class="ach-top"><span class="ach-name">${esc(a.def.name)}</span>${tierLine}</div>
    ${compact ? '' : `<p class="why">${esc(a.def.desc)}</p>`}
    ${state}</div></div>`;
}

function achCounts(list) {
  const shown = list.filter((a) => !a.def.hidden || a.earned);
  const done = list.filter((a) => a.earned);
  return { done: done.length, of: shown.length, xp: done.reduce((s, a) => s + a.xp, 0) };
}

function achievementsCard(list) {
  const c = achCounts(list);
  const latest = list
    .filter((a) => a.earned)
    .sort((x, y) => Date.parse(y.earned.date) - Date.parse(x.earned.date))
    .slice(0, 8);
  const near = A.closest(list);
  return `<section class="card">
    <div class="card-head"><h3>Achievements</h3><span class="muted small">${c.done} of ${c.of} · ${fmtXp(c.xp)} XP</span></div>
    ${latest.length ? `<div class="badge-row">${latest.map((a) => badgeHtml(a)).join('')}</div>` : '<p class="why">Badges you earn show up here.</p>'}
    ${near.length ? `<div class="glabel">Closest</div><div class="ach-list">${near.map((a) => achRow(a, true)).join('')}</div>` : ''}
    <button class="btn block" data-action="tab" data-v="achievements">All achievements ›</button>
  </section>`;
}

function viewAchievements() {
  const list = X.xpLedger(S.workouts, S.settings).achievements;
  const c = achCounts(list);
  const groups = A.groupByCategory(A.sortAndFilter(list, S.achSort, S.achFilter));
  const hiddenLeft = list.some((a) => a.def.hidden && !a.earned);
  const body =
    groups
      .map((g) => {
        const inCat = list.filter((a) => a.def.cat === g.cat.id && (!a.def.hidden || a.earned));
        return `<section class="card"><div class="card-head"><h3>${esc(g.cat.name)}</h3><span class="muted small">${inCat.filter((a) => a.earned).length} of ${inCat.length}</span></div>
          <div class="ach-list">${g.items.map((a) => achRow(a)).join('')}</div></section>`;
      })
      .join('') || `<p class="muted center">${S.achFilter === 'done' ? 'Nothing earned yet — your first badges are close.' : 'All earned!'}</p>`;
  return `<header class="top bar">
      <button class="btn ghost" data-action="tab" data-v="profile">‹ Profile</button>
      <div class="title"><div class="t">Achievements</div><div class="sub">${c.done} of ${c.of} earned · ${fmtXp(c.xp)} XP</div></div>
      <span style="width:60px"></span>
    </header>
    <main class="wrap">
      ${segBtns('achFilter', [['all', 'All'], ['done', 'Achieved'], ['todo', 'Not yet']])}
      ${segBtns('achSort', [['easy', 'Easiest first'], ['hard', 'Hardest first'], ['close', 'Closest first']])}
      ${body}
      ${hiddenLeft ? '<p class="why center">Some achievements are hidden. They show up once you earn them.</p>' : ''}
      <p class="why center">Everything here is worked out from your log: edit or delete a workout and it updates.</p>
    </main>`;
}

// ---------------------------------------------------------------- bodyweight

function openBodyweight(id) {
  const w = id && S.workouts.find((x) => x.id === id);
  if (w) S.bw = { ...clone(w), _editing: true };
  else {
    const last = B.lastBw(S.workouts);
    S.bw = { id: L.makeId(), kind: 'bw', date: null, kg: last ? last.kg : 80 };
  }
  S.bwBack = id ? 'history' : S.view;
  go('bw');
}

function viewBodyweight() {
  const b = S.bw;
  if (!b) return viewHome();
  return `<header class="top bar">
      <button class="btn ghost" data-action="bw-back">‹ Back</button>
      <div class="title"><div class="t">Bodyweight</div><div class="sub">${b._editing ? 'Editing · ' + fmtDate(b.date) : 'Weekly entry'}</div></div>
      <button class="btn primary sm" data-action="bw-save">Save</button>
    </header>
    <main class="wrap">
      <section class="card">
        <p class="why">Best compared week to week: after waking and using the bathroom, before eating.</p>
        <div class="group-head"><span class="glabel">Bodyweight</span>
          <div class="stepper">
            <button class="step" data-action="bw-step" data-v="-0.1" aria-label="Less">−</button>
            <input class="wt" type="text" inputmode="decimal" data-bw value="${B.roundBw(b.kg).toFixed(1)}" aria-label="Bodyweight in kg">
            <span class="unit">kg</span>
            <button class="step" data-action="bw-step" data-v="0.1" aria-label="More">+</button>
          </div></div>
        <label class="lbl" for="bwdate">Date &amp; time</label>
        <input id="bwdate" type="datetime-local" data-bwdate value="${toLocalInput(b.date)}">
      </section>
      <button class="btn primary big block" data-action="bw-save">Save bodyweight</button>
      ${b._editing ? '<button class="btn danger block" data-action="bw-delete">Delete this entry</button>' : ''}
    </main>`;
}

async function saveBodyweight() {
  const b = clone(S.bw);
  const editing = !!b._editing;
  b.kg = B.roundBw(b.kg);
  if (!(b.kg > 0)) return toast('Please enter your bodyweight');
  if (!editing) {
    b.date = b._dateTouched && b.date ? b.date : new Date().toISOString();
    b.createdAt = Date.now();
  } else b.updatedAt = Date.now();
  for (const k of Object.keys(b)) if (k.startsWith('_')) delete b[k];
  const before = editing ? null : xpSnapshot();
  if (editing) S.workouts = S.workouts.map((x) => (x.id === b.id ? b : x));
  else S.workouts.push(b);
  await saveWorkouts();
  const back = editing ? 'history' : S.bwBack === 'progress' ? 'progress' : 'home';
  S.bw = null;
  go(back);
  let extra = '';
  if (before) {
    const led = X.xpLedger(S.workouts, S.settings);
    const gained = led.total - before.total;
    const fresh = led.achievements.filter((a) => a.earned && !before.ach.has(a.def.id)).length;
    if (gained > 0) extra += ` · +${fmtXp(gained)} XP`;
    if (fresh) extra += ` · ${fresh} achievement${fresh > 1 ? 's' : ''} earned`;
  }
  toast(`Bodyweight saved${extra}`);
}

// ---------------------------------------------------------------- workout logging

function cur() {
  return S.edit || S.draft;
}

function startWorkout(idx) {
  const plan = L.planSession(idx, S.workouts, S.settings);
  const d = L.workoutFromPlan(plan);
  d._startedAt = new Date().toISOString();
  d._notes = Object.fromEntries(plan.lifts.map((l) => [l.lift, l.notes]));
  S.draft = d;
  S.edit = null;
  S.homePick = null;
  saveDraftSoon();
  go('workout');
}

function setBtn(path, s, target) {
  const cls = s.done ? (target != null && s.reps < target ? 'done short' : 'done') : '';
  const label = s.done ? `${s.reps} reps, done` : `${s.reps} reps, not done yet`;
  return `<button class="set ${cls}" data-set="${path}" aria-label="${label}">${s.reps}</button>`;
}

function stepper(path, weight) {
  return `<div class="stepper">
    <button class="step" data-action="w-step" data-path="${path}" data-dir="-1" aria-label="Less weight">−</button>
    <input class="wt" type="text" inputmode="decimal" data-weight="${path}" value="${kg(weight)}" aria-label="Weight in kg">
    <span class="unit">kg</span>
    <button class="step" data-action="w-step" data-path="${path}" data-dir="1" aria-label="More weight">+</button>
  </div>`;
}

function testCard(e, li, notes) {
  const best = L.bestCleanSingle(e.attempts);
  const rows = (e.attempts || [])
    .map(
      (a, i) => `<div class="attempt">
        <div class="group-head"><span class="glabel">Attempt ${i + 1}</span>${stepper(`a.${li}.${i}`, a.weight)}</div>
        <div class="attempt-row">
          <div class="seg reps-seg">${[1, 2, 3]
            .map((n) => `<button class="${(a.reps | 0) === n ? 'on' : ''}" data-action="a-reps" data-path="${li}.${i}" data-v="${n}" aria-label="${n} rep${n > 1 ? 's' : ''}">×${n}</button>`)
            .join('')}</div>
          <button class="btn sm ${a.clean === false ? 'danger' : 'good'}" data-action="a-clean" data-path="${li}.${i}">${a.clean === false ? '✗ Not clean' : '✓ Clean'}</button>
          <button class="link" data-action="a-remove" data-path="${li}.${i}" aria-label="Remove attempt">✕</button>
        </div>
      </div>`
    )
    .join('');
  return `<section class="card">
    <div class="lift-head"><h3>${liftName(e.lift)}</h3><span class="badge warn">1RM test</span></div>
    ${notes.map((n) => `<p class="why">${esc(n)}</p>`).join('')}
    ${rows}
    <button class="add" data-action="a-add" data-v="${li}">+ Log an attempt</button>
    <p class="calc">${
      best != null
        ? `Best clean single: <b>${kg(best)} kg</b> → saved as your new 1RM`
        : `No clean single yet — if none, your 1RM stays ${kg(e.oneRM || 0)} kg`
    }</p>
  </section>`;
}

function liftCard(e, li, d) {
  const raw = d._notes?.[e.lift];
  const notes = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (e.type === 'test') return testCard(e, li, notes);
  const tough =
    e.type === '3x5'
      ? `<div class="setting-row tough"><span class="glabel">Was this tough?</span><div class="seg">
          <button class="${e.tough === true ? 'on' : ''}" data-action="tough-set" data-path="${li}" data-v="1">Yes</button>
          <button class="${e.tough === false ? 'on' : ''}" data-action="tough-set" data-path="${li}" data-v="0">No</button></div></div>`
      : '';
  return `<section class="card">
    <div class="lift-head"><h3>${liftName(e.lift)}</h3>${e.deload ? '<span class="badge warn">Deload</span>' : ''}${
      e.type === '3x3' ? '<span class="badge">Triples</span>' : ''
    }</div>
    ${notes.map((n) => `<p class="why">${esc(n)}</p>`).join('')}
    ${tough}
    ${e.groups
      .map(
        (g, gi) => `<div class="group">
          <div class="group-head"><span class="glabel">${esc(g.label)}</span>${stepper(`l.${li}.${gi}`, g.weight)}</div>
          <div class="sets">${g.sets.map((s, si) => setBtn(`l.${li}.${gi}.${si}`, s, g.target)).join('')}</div>
        </div>`
      )
      .join('')}
  </section>`;
}

function cardioCard(d) {
  if (!d.cardio) return `<button class="add" data-action="cardio-add">+ Warm-up cardio</button>`;
  const c = d.cardio;
  const seg = (field, opts) =>
    `<div class="seg">${opts
      .map(([v, t]) => `<button class="${c[field] === v ? 'on' : ''}" data-action="cardio-set" data-path="${field}" data-v="${v}">${t}</button>`)
      .join('')}</div>`;
  return `<section class="card">
    <div class="card-head"><h3>Warm-up cardio</h3><button class="link" data-action="cardio-remove">Remove</button></div>
    ${seg('type', [['run', 'Run'], ['row', 'Row'], ['other', 'Other']])}
    <div class="two">
      <label>Minutes<input type="text" inputmode="decimal" data-bind="cardio.minutes" data-num value="${c.minutes ?? ''}" placeholder="10"></label>
      <label>Distance<input type="text" inputmode="decimal" data-bind="cardio.distance" data-num value="${c.distance ?? ''}" placeholder="${c.unit === 'm' ? '2000' : '2'}"></label>
    </div>
    ${seg('unit', [['km', 'km'], ['m', 'metres']])}
  </section>`;
}

function pullupsCard(d) {
  if (!d.pullups || d.pullups.mode) return pullupCard(d.pullups, 'gym', d._editing ? d.id : null);
  // Pull-ups logged before v4 (3×5, not part of the program).
  return `<section class="card">
    <div class="card-head"><h3>Pull-ups</h3><button class="link" data-action="pu-remove">Remove</button></div>
    <p class="why">Bodyweight · 3×5 · tap when done, hold to change reps</p>
    <div class="sets">${d.pullups.sets.map((s, si) => setBtn(`p.${si}`, s, L.REPS)).join('')}</div>
  </section>`;
}

function extrasCard(d) {
  const items = (d.extras || [])
    .map(
      (x, i) => `<div class="extra">
        <div class="card-head"><input type="text" data-bind="extras.${i}.name" value="${esc(x.name)}" placeholder="Exercise name, e.g. Curls" aria-label="Exercise name">
        <button class="link" data-action="x-remove" data-v="${i}">Remove</button></div>
        <div class="group-head"><span class="glabel">Weight</span>${stepper(`x.${i}`, x.weight)}</div>
        <div class="sets">${x.sets.map((s, si) => `<button class="set plain" data-set="x.${i}.${si}" aria-label="${s.reps} reps, tap to change">${s.reps}</button>`).join('')}
          <button class="set" data-action="x-addset" data-v="${i}" aria-label="Add a set">+</button></div>
      </div>`
    )
    .join('');
  return `<section class="card">
    <div class="card-head"><h3>Extra exercises</h3></div>
    ${items || '<p class="why">Anything else you did, e.g. curls or dips.</p>'}
    <button class="add" data-action="x-add">+ Add exercise</button>
  </section>`;
}

function viewWorkout() {
  const d = cur();
  if (!d) return viewHome();
  const editing = !!d._editing;
  return `<header class="top bar">
      <button class="btn ghost" data-action="w-back">‹ ${editing ? 'Back' : 'Home'}</button>
      <div class="title"><div class="t">${esc(L.workoutTitle(d))}</div>
        <div class="sub">${editing ? 'Editing · ' + fmtDate(d.date) : esc(L.blockLabel(L.blockIdOf(d, S.settings), S.settings))}</div></div>
      <button class="btn primary sm" data-action="w-finish">${editing ? 'Save' : 'Finish'}</button>
    </header>
    <main class="wrap">
      <p class="hint">Tap a set when done · tap again = one rep less · hold = pick reps</p>
      <section class="card fed"><div class="setting-row"><span class="glabel">Ate before training?</span>
        <div class="seg">
          <button class="${d.fed === true ? 'on' : ''}" data-action="fed" data-v="1">Yes</button>
          <button class="${d.fed === false ? 'on' : ''}" data-action="fed" data-v="0">No</button>
        </div></div></section>
      ${cardioCard(d)}
      ${d.lifts.map((e, li) => liftCard(e, li, d)).join('')}
      ${pullupsCard(d)}
      ${extrasCard(d)}
      <section class="card"><label class="lbl" for="notes">Notes</label>
        <textarea id="notes" data-bind="notes" rows="3" placeholder="How did it feel?">${esc(d.notes)}</textarea></section>
      <section class="card"><label class="lbl" for="wdate">Date &amp; time</label>
        <input id="wdate" type="datetime-local" data-date value="${toLocalInput(d.date || d._startedAt)}">
        ${editing ? '' : '<p class="why">Saved with the time you tap Finish, unless you change it here.</p>'}</section>
      <button class="btn primary big block" data-action="w-finish">${editing ? 'Save changes' : 'Finish workout'}</button>
      ${
        editing
          ? '<button class="btn danger block" data-action="w-delete">Delete this workout</button>'
          : '<button class="btn danger block" data-action="w-discard">Discard this workout</button>'
      }
    </main>`;
}

function resolveSet(path) {
  const d = cur();
  const p = path.split('.');
  if (p[0] === 'l') {
    const g = d.lifts[+p[1]].groups[+p[2]];
    return { set: g.sets[+p[3]], target: g.target, kind: 'lift', title: `${liftName(d.lifts[+p[1]].lift)} · ${g.label}` };
  }
  if (p[0] === 'p' || p[0] === 'hp') {
    const rec = p[0] === 'p' ? d.pullups : S.home.items[+p[1]];
    const si = +p[p.length - 1];
    const target = rec.mode ? (rec.ladder ? rec.ladder[si] : null) : L.REPS;
    return { set: rec.sets[si], target, kind: 'pullup', title: 'Pull-ups' };
  }
  const x = d.extras[+p[1]];
  return { set: x.sets[+p[2]], target: null, kind: 'extra', title: x.name || 'Extra exercise', list: x.sets, index: +p[2] };
}

function touched() {
  if (S.view === 'homesess') S.homeDirty = true;
  else if (S.edit) S.editDirty = true;
  else saveDraftSoon();
}

function tapSet(path) {
  const r = resolveSet(path);
  if (r.kind === 'extra') return openRepsPicker(path);
  const s = r.set;
  if (!s.done) {
    s.done = true;
    if (r.target != null) s.reps = r.target;
    if (S.view === 'workout') startRest();
  } else if (s.reps > 0) s.reps -= 1;
  else {
    s.done = false;
    s.reps = r.target != null ? r.target : 1;
  }
  touched();
  render();
}

function openRepsPicker(path) {
  const r = resolveSet(path);
  S.sheet = {
    kind: 'reps',
    path,
    title: r.title,
    current: r.set.done || r.kind === 'extra' ? r.set.reps : null,
    max: r.kind === 'extra' ? 30 : 15,
    allowUndo: r.kind !== 'extra',
    allowDelete: r.kind === 'extra',
  };
  render();
}

function weightTarget(path) {
  const d = cur();
  const p = path.split('.');
  if (p[0] === 'l') {
    const e = d.lifts[+p[1]];
    return { obj: e.groups[+p[2]], entry: e, step: S.settings.lifts[e.lift].increment };
  }
  if (p[0] === 'a') {
    const e = d.lifts[+p[1]];
    return { obj: e.attempts[+p[2]], step: S.settings.lifts[e.lift].increment };
  }
  if (p[0] === 'pk') return { obj: d.pullups, step: S.settings.rounding || 2.5 };
  if (p[0] === 'hk') {
    const it = S.home.items[+p[1]];
    const bell = ['swings', 'getups', 'press'].includes(it.move);
    return { obj: { get weight() { return it.kg || 0; }, set weight(v) { it.kg = v; } }, step: bell ? 4 : S.settings.rounding || 2.5 };
  }
  return { obj: d.extras[+p[1]], step: S.settings.rounding || 2.5 };
}

/** After a weight change: the back-off set follows the top set (−10%) until you set it yourself. */
function afterWeightChange(t) {
  if (!t.entry) return;
  if (t.obj.role === 'backoff') t.obj.auto = undefined;
  if (t.obj.role === 'top') {
    const b = t.entry.groups.find((g) => g.role === 'backoff');
    if (b && b.auto) b.weight = L.backoffFor(t.obj.weight, S.settings);
  }
}

async function finishWorkout() {
  const d = cur();
  const editing = !!d._editing;
  // 3–5 block: after each 3×5 with all reps made, ask "Was this tough?"
  const ask = d.lifts.findIndex(
    (e) => e.type === '3x5' && e.tough === undefined && e.groups[0].sets.every((s) => s.done && s.reps >= 5)
  );
  if (ask >= 0) {
    S.sheet = { kind: 'tough', li: ask };
    return render();
  }
  const undone = d.lifts.some((e) => e.groups.some((g) => g.sets.some((s) => !s.done)));
  if (
    undone &&
    !confirm("Some sets aren't ticked as done. They'll be saved as not done (that counts as missed reps). Save anyway?")
  )
    return;
  const w = clone(d);
  if (!editing) {
    w.date = w._dateTouched && w.date ? w.date : new Date().toISOString();
    w.createdAt = Date.now();
  } else {
    w.updatedAt = Date.now();
  }
  if (w.cardio && w.cardio.minutes == null && w.cardio.distance == null) w.cardio = null;
  // Pull-ups added but nothing ticked: not a pull-up session (so it can't use up today's).
  if (w.pullups && w.pullups.mode && !w.pullups.sets.some((s) => s.done)) w.pullups = null;
  w.extras = (w.extras || []).filter((x) => (x.name || '').trim() || x.sets.length);
  for (const k of Object.keys(w)) if (k.startsWith('_')) delete w[k];

  const before = editing ? null : xpSnapshot();
  if (editing) S.workouts = S.workouts.map((x) => (x.id === w.id ? w : x));
  else S.workouts.push(w);
  await saveWorkouts();
  if (editing) {
    S.edit = null;
    S.editDirty = false;
    go('history');
    toast('Changes saved — plan updated');
  } else {
    S.draft = null;
    await db.set('draft', undefined);
    go('home');
    const sc = L.schedule(S.workouts, S.settings);
    toast(sc.blockDone ? 'Saved! Block finished — set up the next block on Home.' : `Saved! Next up: ${sc.nextName}`);
    showFinishCard(w.id, before);
  }
}

// ---------------------------------------------------------------- rest timer

let timerInt = null;
let audio = null;

function ensureAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) {
    /* no audio */
  }
}

function ring() {
  try {
    navigator.vibrate && navigator.vibrate([250, 120, 250]);
  } catch (e) {}
  if (!audio) return;
  const t0 = audio.currentTime + 0.02;
  [0, 0.28, 0.56].forEach((dt) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.2);
    o.connect(g).connect(audio.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.22);
  });
}

function startRest() {
  if (!S.draft || S.edit) return;
  S.draft._timerEnd = Date.now() + S.settings.restSeconds * 1000;
  S.draft._timerTotal = S.settings.restSeconds;
  S.draft._timerRang = false;
  saveDraftSoon();
  if (!timerInt) timerInt = setInterval(tickTimer, 250);
  tickTimer();
}

function stopRest() {
  if (S.draft) {
    S.draft._timerEnd = null;
    saveDraftSoon();
  }
  tickTimer();
}

function tickTimer() {
  const d = S.draft;
  const end = d && d._timerEnd;
  if (!end || S.view !== 'workout' || S.edit) {
    $timer.hidden = true;
    if (!end && timerInt) {
      clearInterval(timerInt);
      timerInt = null;
    }
    return;
  }
  if (!timerInt) timerInt = setInterval(tickTimer, 250);
  if (!$timer.firstChild) {
    $timer.innerHTML = `<div class="t-bar"><div class="t-fill"></div></div>
      <div class="in"><div><div class="t-label">REST</div><div class="t-left"></div></div><div class="grow"></div>
      <button class="btn sm" data-action="t-add" data-v="-30">−30s</button>
      <button class="btn sm" data-action="t-add" data-v="30">+30s</button>
      <button class="btn sm" data-action="t-skip">Skip</button></div>`;
  }
  $timer.hidden = false;
  const left = (end - Date.now()) / 1000;
  const over = left <= 0;
  $timer.classList.toggle('over', over);
  $timer.querySelector('.t-label').textContent = over ? 'REST OVER — NEXT SET!' : 'REST';
  $timer.querySelector('.t-left').textContent = over ? mmss(-left) : mmss(Math.ceil(left));
  $timer.querySelector('.t-fill').style.width = over ? '100%' : `${100 - (left / (d._timerTotal || 180)) * 100}%`;
  if (over && !d._timerRang) {
    d._timerRang = true;
    saveDraftSoon();
    ring();
  }
  if (over && -left > 60) stopRest(); // hide a minute after it's done
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      const w = wakeLock;
      wakeLock = null;
      await w.release();
    }
  } catch (e) {
    wakeLock = null;
  }
}

// ---------------------------------------------------------------- block start screen

function openBlockSetup() {
  S.blockDraft = clone(L.proposeNextBlock(S.workouts, S.settings));
  go('blockstart');
}

function firstTfWeight(liftId) {
  const b = S.blockDraft;
  const rm = Number(b.oneRM[liftId]);
  return rm > 0 ? L.roundTo(rm * b.startPct, S.settings.rounding) : null;
}

function viewBlockStart() {
  const b = S.blockDraft;
  if (!b) return viewHome();
  const program = L.programFor(b.kind);
  const input = (path, val, extra = '') =>
    `<input type="text" inputmode="decimal" data-bind="bd:${path}" data-num ${extra} value="${val ?? ''}">`;
  let body;
  if (b.kind === '3-5') {
    body = `<section class="card">
        <h3>Conservative 1RM per lift (kg)</h3>
        <p class="why">The most you can lift once with perfect technique — not a grinder.</p>
        ${L.LIFTS.map((l) => {
          const fw = firstTfWeight(l.id);
          return `<div class="group"><div class="group-head"><span class="lift-name">${l.name}</span>
            <div class="bd-input">${input(`oneRM.${l.id}`, b.oneRM[l.id], 'placeholder="required"')}</div></div>
            <p class="calc" data-first="${l.id}">${fw != null ? `First session: 3×5 at <b>${kg(fw)} kg</b>` : 'Enter a 1RM'}</p></div>`;
        }).join('')}
      </section>
      <section class="card">
        <div class="two">
          <label>Start at % of 1RM (65–70)${input('startPct', L.fmtPct(b.startPct), 'data-pct')}</label>
          <label>Add each session, % of 1RM (2–3)${input('stepPct', L.fmtPct(b.stepPct), 'data-pct')}</label>
        </div>
        <p class="why">Each lift: 3×5, adding a little every session → triples when it gets tough → two 3×3 sessions → 1RM test → start over. The block ends when all four lifts have been tested. Rest a full 5 minutes between sets.</p>
      </section>`;
  } else {
    body = `<section class="card">
        <h3>Starting weights (kg)</h3>
        <p class="why">Carried on from where your last 5×5 block ended. Change any number if you want to.</p>
        ${L.LIFTS.map(
          (l) => `<div class="group"><div class="lift-name">${l.name}</div>
            <div class="two" style="margin-top:8px">
              <label>Volume 5×5${input(`weights.${l.id}.volume`, kg(b.weights[l.id].volume))}</label>
              <label>Heavy top set${input(`weights.${l.id}.heavy`, kg(b.weights[l.id].heavy))}</label>
            </div></div>`
        ).join('')}
      </section>
      <section class="card">
        <h3>Block length</h3>
        <div class="seg">${L.BLOCK_LENGTHS.map(
          (n) => `<button class="${b.length === n ? 'on' : ''}" data-action="bd-len" data-v="${n}">${n}</button>`
        ).join('')}</div>
        <p class="why">Gym workouts (${b.length / 6} full cycles). Starts at #1 A — Volume.</p>
      </section>`;
  }
  return `<header class="top bar">
      <button class="btn ghost" data-action="tab" data-v="home">‹ Home</button>
      <div class="title"><div class="t">New block</div><div class="sub">${esc(program.name)}</div></div>
      <span style="width:60px"></span>
    </header>
    <main class="wrap">
      <section class="card"><h2>${esc(program.name)}</h2><p class="why">${esc(program.about)}</p></section>
      ${body}
      <button class="btn primary big block" data-action="block-start">Start block</button>
    </main>`;
}

function updateBlockStartCalcs() {
  if (!S.blockDraft || S.blockDraft.kind !== '3-5') return;
  for (const l of L.LIFTS) {
    const el = $app.querySelector(`[data-first="${l.id}"]`);
    const fw = firstTfWeight(l.id);
    if (el) el.innerHTML = fw != null ? `First session: 3×5 at <b>${kg(fw)} kg</b>` : 'Enter a 1RM';
  }
}

// ---------------------------------------------------------------- history

function pullupSummary(rec, counts) {
  const sets = rec.sets.map((s) => (s.done ? s.reps : '–')).join(',');
  const what = rec.mode === 'test' ? `max test ${sets}` : sets;
  const w = rec.kg ? ` +${kg(rec.kg)} kg` : '';
  return `Pull-ups ${what}${w}${rec.mode && counts === false ? " (didn't count)" : ''}`;
}

function summary(w, counted) {
  if (w.kind === 'bw') return `${B.roundBw(w.kg).toFixed(1)} kg`;
  if (w.kind === 'home') {
    const p = H.homeItems(w)
      .map((it) => (it.move === 'pullups' ? pullupSummary(it, counted.get(w.id)) : H.itemSummary(it)))
      .filter(Boolean);
    if (w.minutes) p.push(`${w.minutes} min`);
    return p.join(' · ');
  }
  const parts = (w.lifts || []).map((e) => {
    const nm = L.LIFT_BY_ID[e.lift]?.short || e.lift;
    if (e.type === 'test') {
      const as = (e.attempts || []).map((a) => `${kg(a.weight)}×${a.reps}${a.clean === false ? ' ✗' : ''}`).join(', ');
      return `${nm} 1RM test ${as || '(no attempts)'}`;
    }
    const gs = e.groups
      .map((g) => `${kg(g.weight)}×${g.sets.map((s) => (s.done ? s.reps : '–')).join(',')}`)
      .join(' + ');
    return `${nm} ${gs}${e.deload ? ' (deload)' : ''}${e.tough ? ' (tough)' : ''}`;
  });
  if (w.pullups) parts.push(pullupSummary(w.pullups, counted.get(w.id)));
  if (w.extras?.length) parts.push(`+${w.extras.length} extra`);
  return parts.join(' · ');
}

function viewHistory() {
  const list = L.sortByDate(S.workouts).reverse();
  const counted = new Map(P.pullupRecords(S.workouts).map((r) => [r.id, r.counts]));
  let month = '';
  const rows = list
    .map((w) => {
      const m = new Date(w.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const head = m !== month ? `<div class="month">${(month = m)}</div>` : '';
      const title = w.kind === 'home' ? 'Home session' : w.kind === 'bw' ? 'Bodyweight' : esc(L.workoutTitle(w));
      return `${head}<button class="hrow" data-action="h-open" data-v="${esc(w.id)}">
        <div class="hdate">${fmtDate(w.date)} · ${fmtTime(w.date)} ${blockTag(w)}</div>
        <div class="htitle">${title}</div>
        <div class="hsum">${esc(summary(w, counted))}</div></button>`;
    })
    .join('');
  return `<header class="top"><h1>History</h1></header>
    <main class="wrap">${thenVsNowCard()}${rows || '<p class="muted center">No workouts yet. Finished workouts show up here — tap one to see or edit it.</p>'}</main>`;
}

function thenVsNowCard() {
  const t = A.thenVsNow(S.workouts);
  if (!t.lifts.length && !t.bw) return '';
  const d = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  // Lifts going up is shown in green; bodyweight change is shown neutral.
  const diff = (x, unit, colour = true) =>
    x === 0 ? `<span class="tvn-diff">±0 ${unit}</span>` : `<span class="tvn-diff ${colour && x > 0 ? 'up' : ''}">${x > 0 ? '+' : '−'}${kg(Math.abs(x))} ${unit}</span>`;
  const lifts = t.lifts
    .map(
      (l) => `<div class="tvn-row"><div class="tvn-top"><span class="lift-name">${esc(liftName(l.lift))}</span>${diff(l.diff, 'kg')}</div>
        <div class="tvn-nums">${kg(l.then.weight)} kg × ${l.then.reps} <span class="muted">(${d(l.then.date)})</span> → <b>${kg(l.now.weight)} kg × ${l.now.reps}</b> <span class="muted">(${d(l.now.date)})</span></div></div>`
    )
    .join('');
  const bw = t.bw
    ? `<div class="tvn-row"><div class="tvn-top"><span class="lift-name">Bodyweight</span>${t.bw.count > 1 ? diff(t.bw.diff, 'kg', false) : ''}</div>
        <div class="tvn-nums">${B.roundBw(t.bw.then.kg).toFixed(1)} kg <span class="muted">(${d(t.bw.then.date)})</span>${
          t.bw.count > 1 ? ` → <b>${B.roundBw(t.bw.now.kg).toFixed(1)} kg</b> <span class="muted">(${d(t.bw.now.date)})</span>` : ''
        }</div></div>`
    : '';
  return `<section class="card tvn"><h3>Then vs now</h3>${lifts}${bw}
    <p class="why">Your first logged top set → your best set ever (exact logged numbers). Bodyweight: first → latest entry.</p></section>`;
}

function openHistory(id) {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return;
  if (w.kind === 'home') {
    openSavedHome(id, 'history');
  } else if (w.kind === 'bw') {
    openBodyweight(w.id);
  } else {
    S.edit = { ...clone(w), _editing: true };
    S.editDirty = false;
    go('workout');
  }
}

// ---------------------------------------------------------------- progress

const CHARTS = new Map(); // chart id → points with screen positions

function niceStep(range) {
  for (const s of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) if (range / s <= 5) return s;
  return 200;
}

/** Line chart of points [{ date, value, head, tip }] (one series). */
function chartSvg(id, points, label) {
  const W = 340,
    Hh = 210,
    pl = 40,
    pr = 14,
    pt = 34,
    pb = 26;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (hi - lo < 4) {
    lo -= 2;
    hi += 2;
  }
  if (lo < 0 && Math.min(...vals) >= 0) lo = 0;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const t0 = Date.parse(points[0].date),
    t1 = Date.parse(points[points.length - 1].date);
  const x = (t) => (t1 === t0 ? pl + (W - pl - pr) / 2 : pl + ((t - t0) / (t1 - t0)) * (W - pl - pr));
  const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (Hh - pt - pb);
  const pts = points.map((p) => ({ ...p, cx: x(Date.parse(p.date)), cy: y(p.value) }));
  CHARTS.set(id, pts);

  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${kg(v)}</text>`;
  }
  const xl = (p, anchor) =>
    `<text x="${p.cx}" y="${Hh - 6}" text-anchor="${anchor}" font-size="11" fill="var(--muted)">${new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`;
  const first = pts[0],
    last = pts[pts.length - 1];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
  const dots = pts
    .map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="4.5" fill="var(--chart)" stroke="var(--surface)" stroke-width="2"/>`)
    .join('');
  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(label)} over time" data-chart="${id}">
      ${grid}
      <path d="${path}" fill="none" stroke="var(--chart)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="xhair" x1="0" x2="0" y1="${pt}" y2="${Hh - pb}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
      ${dots}
      ${xl(first, pts.length > 1 ? 'start' : 'middle')}${pts.length > 1 ? xl(last, 'end') : ''}
      <rect class="chart-hit" x="0" y="0" width="${W}" height="${Hh}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div></div>`;
}

function showTip(ev) {
  const hit = ev.target.closest('.chart-hit');
  if (!hit) return;
  const svg = hit.ownerSVGElement;
  const pts = CHARTS.get(svg.dataset.chart);
  if (!pts || !pts.length) return;
  const box = svg.getBoundingClientRect();
  const vx = ((ev.clientX - box.left) / box.width) * 340;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.cx - vx) < Math.abs(best.cx - vx)) best = p;
  const tip = svg.parentElement.querySelector('.chart-tip');
  const xh = svg.querySelector('.xhair');
  xh.setAttribute('x1', best.cx);
  xh.setAttribute('x2', best.cx);
  xh.setAttribute('visibility', 'visible');
  tip.innerHTML = `<b>${esc(best.head)}</b> · ${fmtDate(best.date)}${best.tip ? `<br><span class="muted">${esc(best.tip)}</span>` : ''}`;
  tip.hidden = false;
  const px = (best.cx / 340) * box.width;
  tip.style.left = Math.min(Math.max(px, 90), box.width - 90) + 'px';
}

function listTable(rows, empty) {
  return rows.length
    ? `<table class="best"><tbody>${rows.map((r) => `<tr><td>${r.label}</td><td>${r.date ? fmtDate(r.date, true) : ''}</td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${empty}</p>`;
}

function segBtns(field, opts) {
  return `<div class="seg">${opts
    .map(([v, t]) => `<button class="${S[field] === v ? 'on' : ''}" data-action="prog" data-path="${field}" data-v="${v}">${t}</button>`)
    .join('')}</div>`;
}

function progressGym() {
  const lift = S.progressLift;
  const all = L.liftHistory(S.workouts, lift);
  const tf = ['3x5', '3x3', 'test'];
  const hist =
    S.progressType === 'all'
      ? all
      : all.filter((h) => (S.progressType === '3-5' ? tf.includes(h.type) : h.type === S.progressType));
  const pts = hist.map((h) => ({
    date: h.date,
    value: h.top,
    head: `${kg(h.top)} kg · ${L.TYPE_LABEL[h.type] || ''}${h.deload ? ' (deload)' : ''}`,
    tip: h.sets.map((s) => `${kg(s.weight)}×${s.reps}`).join(', '),
  }));
  const best = L.bestSets(S.workouts, lift, 8).map((b) => ({ label: `<b>${kg(b.weight)} kg</b> × ${b.reps}`, date: b.date }));
  const rms = L.oneRMHistory(S.workouts, S.settings, lift).map((r) => ({
    label: `<b>${kg(r.weight)} kg</b> · ${r.source === 'tested' ? 'tested' : 'entered at block start'}`,
    date: r.date,
  }));
  return `${segBtns('progressLift', L.LIFTS.map((l) => [l.id, l.short]))}
    <section class="card">
      <h3>${liftName(lift)} · top set (kg)</h3>
      ${segBtns('progressType', [['all', 'All'], ['volume', 'Vol'], ['heavy', 'Heavy'], ['unload', 'Unload'], ['3-5', '3–5']])}
      ${pts.length ? chartSvg('gym', pts, 'Top set') + '<p class="why">Tap the chart to see a day.</p>' : '<p class="muted">Nothing logged yet for this lift.</p>'}
    </section>
    <section class="card"><h3>Best sets</h3>${listTable(best, 'Your heaviest sets will be listed here.')}</section>
    <section class="card"><h3>1RMs</h3>${listTable(rms, '1RMs from the 3–5 block (entered and tested) will be listed here.')}</section>`;
}

function progressRecords() {
  const wall = A.recordWall(S.workouts);
  const d = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
  const cell = (r) => (r ? `<td><b>${kg(r.weight)}</b><small>${d(r.date)}</small></td>` : '<td class="muted">–</td>');
  const any = L.LIFTS.some((l) => wall[l.id][1]);
  return `<section class="card"><h3>Record wall (kg)</h3>
      ${
        any
          ? `<table class="rwall"><thead><tr><th></th>${A.RECORD_REPS.map((r) => `<th>${r} rep${r > 1 ? 's' : ''}</th>`).join('')}</tr></thead>
        <tbody>${L.LIFTS.map((l) => `<tr><th>${esc(l.short)}</th>${A.RECORD_REPS.map((r) => cell(wall[l.id][r])).join('')}</tr>`).join('')}</tbody></table>`
          : '<p class="muted">Your records show up here after your first gym session.</p>'
      }
      <p class="why">Best weight for a set of at least 1, 3 or 5 clean reps: ticked sets and clean 1RM attempts, exact logged weights, with the first day you lifted it.</p>
    </section>`;
}

function progressHome() {
  const moves = H.loggedMoves(S.workouts);
  if (!moves.length) return '<section class="card"><p class="muted">Home movements you log will show up here.</p></section>';
  const sel = moves.find((m) => m.key === S.progressMove) || moves[0];
  const pr = H.homeProgress(S.workouts, sel.move, sel.move === 'custom' ? sel.name : undefined);
  const charts = pr.charts
    .filter((c) => c.points.length)
    .map(
      (c, ci) => `<section class="card"><h3>${esc(sel.name)} · ${esc(c.title)}</h3>
        ${chartSvg('home' + ci, c.points.map((p) => ({ ...p, head: `${kg(p.value)}` })), c.title)}</section>`
    )
    .join('');
  const bests = pr.bests.map((b) => ({ label: esc(b.label) + (b.extra ? ` <span class="muted">· ${esc(b.extra)}</span>` : ''), date: b.date }));
  return `<div class="chips">${moves
    .map((m) => `<button class="chip-set ${m.key === sel.key ? 'on' : ''}" data-action="prog" data-path="progressMove" data-v="${esc(m.key)}">${esc(m.name)}</button>`)
    .join('')}</div>
    ${charts}
    <section class="card"><h3>Bests</h3>${listTable(bests, 'Nothing yet.')}</section>`;
}

function progressPullups() {
  const st = puState();
  const pr = P.pullupProgress(S.workouts, S.settings);
  const pts = pr.sessions.map((s) => ({ ...s, head: `${s.value} reps` }));
  const tests = pr.tests.map((t) => ({
    label: `<b>${t.max}</b> reps${t.kg ? ` +${kg(t.kg)} kg` : ''} · ${t.source === 'setup' ? 'entered at setup' : 'tested'}`,
    date: t.date,
  }));
  const status =
    st.phase === 'setup'
      ? '<p class="why">Not set up yet.</p><button class="btn block" data-action="pu-setup">Set up the pull-up program</button>'
      : `<p><b>${esc(st.program.name)}</b></p><p class="calc">Max ${st.max}${st.kg ? ` +${kg(st.kg)} kg` : ''} · ${esc(st.progress || pullupLine(st))}</p>`;
  return `<section class="card"><h3>Pull-up program</h3>${status}</section>
    <section class="card"><h3>Total reps per session</h3>
      ${pts.length ? chartSvg('pu', pts, 'Pull-up reps') : '<p class="muted">Pull-up sessions you log will show up here.</p>'}</section>
    <section class="card"><h3>Max reps</h3>${listTable(tests, 'Your tested maxes will be listed here.')}</section>`;
}

function progressBody() {
  const all = B.bwEntries(S.workouts);
  const pts = all.map((b) => ({ date: b.date, value: B.roundBw(b.kg), head: `${B.roundBw(b.kg).toFixed(1)} kg` }));
  const rows = [...all].reverse().map((b) => ({ label: `<b>${B.roundBw(b.kg).toFixed(1)} kg</b>`, date: b.date }));
  return `<section class="card"><h3>Bodyweight (kg)</h3>
      ${pts.length ? chartSvg('bw', pts, 'Bodyweight') : '<p class="muted">Log your bodyweight once a week to see it here.</p>'}
      <button class="btn block" data-action="bw-new">Log bodyweight</button></section>
    <section class="card"><h3>All entries</h3>${listTable(rows, 'No entries yet.')}
      <p class="why">Change or delete an entry in History.</p></section>`;
}

function viewProgress() {
  CHARTS.clear();
  const area = S.progressArea;
  const body =
    area === 'home'
      ? progressHome()
      : area === 'pullups'
        ? progressPullups()
        : area === 'body'
          ? progressBody()
          : area === 'records'
            ? progressRecords()
            : progressGym();
  return `<header class="top"><h1>Progress</h1></header>
    <main class="wrap">
      ${segBtns('progressArea', [['gym', 'Gym'], ['records', 'Records'], ['home', 'Home'], ['pullups', 'Pull-ups'], ['body', 'Body']])}
      ${body}
    </main>`;
}

// ---------------------------------------------------------------- settings

function viewSettings() {
  const cw = L.currentWeights(S.workouts, S.settings);
  const sc = L.schedule(S.workouts, S.settings);
  const bs = L.blockStatus(S.workouts, S.settings);
  const undo = L.canUndoSwitch(S.workouts, S.settings);
  const st = S.settings;
  const tfBlock = bs.block.kind === '3-5' ? bs.block : null;
  const startPct = tfBlock ? tfBlock.startPct : st.tfStartPct;
  const stepPct = tfBlock ? tfBlock.stepPct : st.tfStepPct;
  const rmLine = tfBlock
    ? `<p class="calc">1RMs now: ${L.LIFTS.map((l) => `${l.tag} <b>${kg(bs.lifts[l.id].oneRM)}</b>`).join(' · ')}</p>`
    : '';
  const liftCards = L.LIFTS.map((l) => {
    const c = cw[l.id];
    const f = (field, label, val) =>
      `<label>${label}<input type="text" inputmode="decimal" data-setw="${l.id}.${field}" value="${kg(val)}"></label>`;
    const flags = [];
    if (c.heavyMisses) flags.push('Top set missed last heavy day — miss again and heavy drops 10%.');
    return `<div class="group"><div class="lift-name">${l.name}</div>
      <div class="wgrid" style="margin-top:8px">${f('volume', 'Volume', c.volume)}${f('heavy', 'Heavy', c.heavy)}${f('increment', 'Step +', c.increment)}</div>
      <p class="calc">Calculated: back-off <b>${kg(c.backoff)}</b> (heavy −10%) · unload 5×4 <b>${kg(c.unload)}</b> (80% of this cycle's 5×5)</p>
      ${flags.length ? `<p class="why">${flags.join(' ')}</p>` : ''}</div>`;
  }).join('');
  const seg = (action, opts, curV) =>
    `<div class="seg">${opts.map(([v, t]) => `<button class="${String(curV) === String(v) ? 'on' : ''}" data-action="${action}" data-v="${v}">${t}</button>`).join('')}</div>`;
  const gyms = S.workouts.filter((w) => w.kind === 'gym').length;
  return `<header class="top"><h1>Settings</h1></header>
    <main class="wrap">
      ${updateBanner()}
      <section class="card">
        <h3>Training block</h3>
        <p><b>${esc(bs.text)}</b></p>
        ${rmLine}
        <div class="group">
          <span class="glabel">5×5 block length (gym workouts)</span>
          <div class="seg" style="margin-top:8px">${L.BLOCK_LENGTHS.map(
            (n) => `<button class="${(bs.block.kind === '5x5' ? bs.length : st.block5x5Length) === n ? 'on' : ''}" data-action="set-len" data-v="${n}">${n}</button>`
          ).join('')}</div>
        </div>
        <div class="group">
          <span class="glabel">3–5 block</span>
          <div class="two" style="margin-top:8px">
            <label>Start % of 1RM (65–70)<input type="text" inputmode="decimal" data-tf="startPct" value="${L.fmtPct(startPct)}"></label>
            <label>Add % each session (2–3)<input type="text" inputmode="decimal" data-tf="stepPct" value="${L.fmtPct(stepPct)}"></label>
          </div>
        </div>
        <p class="why">Blocks rotate 5×5 → 3–5 → 5×5 … by number of gym workouts, never by date. Home Simple &amp; Sinister doesn't count.</p>
        ${bs.done ? '' : `<button class="btn block" data-action="switch-block">Switch to the ${esc(L.programFor(bs.next).name)} now</button>`}
        ${undo ? '<button class="btn block" data-action="undo-switch">Go back to the previous block</button>' : ''}
      </section>
      <section class="card">
        <h3>5×5 working weights (kg)</h3>
        <p class="why">${
          bs.block.kind === '5x5' ? 'What your next sessions will use.' : 'Used when the 5×5 block comes back.'
        } Change any number and it applies from your next workout. "Step +" is how much volume goes up after a full 5×5, and heavy after a full top set.</p>
        ${liftCards}
      </section>
      <section class="card">
        <h3>Round weights to</h3>
        <p class="why">Use 1.25 if you have small 0.625 kg plates.</p>
        ${seg('set-round', [['0.5', '0.5'], ['1', '1'], ['1.25', '1.25'], ['2.5', '2.5'], ['5', '5']], st.rounding)}
      </section>
      <section class="card">
        <div class="setting-row"><h3>Rest timer</h3>
          <div class="stepper"><button class="step" data-action="rest-step" data-v="-15" aria-label="Shorter">−</button>
          <span class="big-num">${mmss(st.restSeconds)}</span>
          <button class="step" data-action="rest-step" data-v="15" aria-label="Longer">+</button></div></div>
        <p class="why">Starts by itself when you tick a set. Beeps at the end (iPhone ring switch must be on).</p>
      </section>
      ${(() => {
        const ps = puState();
        const on = ps.phase !== 'setup';
        return `<section class="card">
        <h3>Pull-up program</h3>
        ${on ? `<p><b>${esc(ps.program.name)}</b></p><p class="calc">Max ${ps.max}${ps.kg ? ` +${kg(ps.kg)} kg` : ''} · ${esc(ps.progress || pullupLine(ps))}</p>` : ''}
        <p class="why">Pavel's Fighter Pullup Program. Runs alongside everything else: log it on gym days or in a home session. Only the first pull-up session each day counts. It never changes the gym plan.</p>
        <button class="btn block" data-action="pu-setup">${on ? 'Change my max (restarts the program)' : 'Set up the pull-up program'}</button>
      </section>`;
      })()}
      <section class="card">
        <h3>Sequence</h3>
        <p>Next gym session: <b>${esc(sc.nextName)}</b></p>
        ${bs.done ? '' : '<button class="btn block" data-action="seq-pick">Change where I am in the sequence</button>'}
      </section>
      <section class="card">
        <h3>Backup</h3>
        <p class="why">Your data lives only on this iPhone. Save a backup file now and then (e.g. to iCloud Drive via "Save to Files").
        Last backup: <b>${st.lastExportAt ? fmtDate(st.lastExportAt, true) + ` (${daysAgo(st.lastExportAt)})` : 'never'}</b>.</p>
        <button class="btn primary block" data-action="export">Export backup file</button>
        <label class="btn block file-btn">Import backup file<input type="file" accept=".json,application/json" data-import></label>
      </section>
      <section class="card">
        <h3>Game mode</h3>
        ${seg('set-game', [['on', 'On'], ['off', 'Off']], gameOn() ? 'on' : 'off')}
        <p class="why">XP, levels, belts, achievements, the Profile tab and the card after each session. Off = a plain training log (records and "Then vs now" stay). Your XP and achievements are always worked out from your log, so nothing is lost when you switch.</p>
        ${gameOn() ? `<label class="lbl" for="pname">Your name (Profile)</label><input id="pname" type="text" data-name value="${esc(st.name || '')}" placeholder="e.g. Alex">` : ''}
      </section>
      <section class="card">
        <h3>Look</h3>
        ${seg('set-theme', [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match iPhone']], st.theme || 'dark')}
      </section>
      <section class="card small muted">
        <p>Strength Log ${APP_VERSION} · ${gyms} gym + ${S.workouts.filter((w) => w.kind === 'home').length} home sessions + ${
          S.workouts.filter((w) => w.kind === 'bw').length
        } bodyweight entries saved on this device (${db.backend()}).
        ${S.persisted ? 'Storage is protected from automatic clean-up.' : ''}</p>
        <p>Works offline. Open it from the Home Screen icon so you always use the same data.</p>
      </section>
    </main>`;
}

async function exportBackup() {
  const data = JSON.stringify(L.makeBackup(S.settings, S.workouts), null, 1);
  const name = `strength-log-backup-${toLocalInput().slice(0, 10)}.json`;
  const blob = new Blob([data], { type: 'application/json' });
  const done = () => {
    S.settings.lastExportAt = new Date().toISOString();
    S.settings.backupSnoozeUntil = null;
    saveSettings();
    render();
    toast('Backup file saved');
  };
  let file = null;
  try {
    file = new File([blob], name, { type: 'application/json' });
  } catch (e) {}
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Strength Log backup' });
      done();
    } catch (err) {
      if (err && err.name === 'AbortError') toast('Backup cancelled');
      else download(blob, name, done);
    }
  } else download(blob, name, done);
}

function download(blob, name, done) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  done();
}

async function importBackup(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  let b;
  try {
    b = L.readBackup(JSON.parse(await f.text()));
  } catch (e) {
    alert("That file couldn't be read as a Strength Log backup.\n\n" + (e.message || e));
    return;
  }
  if (
    !confirm(
      `Replace everything in the app with this backup?\n\nBackup: ${b.workouts.length} sessions.\nNow in the app: ${S.workouts.length} sessions (these will be replaced).`
    )
  )
    return;
  S.settings = b.settings;
  S.workouts = b.workouts;
  await saveSettings();
  await saveWorkouts();
  applyTheme();
  render();
  toast(`Backup restored — ${b.workouts.length} sessions`);
}

function applyTheme() {
  const t = S.settings.theme || 'dark';
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('sl-theme', t);
  } catch (e) {}
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0f1115' : '#f2f3f5';
}

// ---------------------------------------------------------------- sheets

function viewSheet() {
  const sh = S.sheet;
  let body = '';
  if (sh.kind === 'reps') {
    const nums = Array.from({ length: sh.max + 1 - (sh.allowDelete ? 1 : 0) }, (_, i) => i + (sh.allowDelete ? 1 : 0));
    body = `<h3>${esc(sh.title)} — reps</h3>
      <div class="grid-reps">${nums.map((n) => `<button class="rep ${n === sh.current ? 'cur' : ''}" data-action="pick-reps" data-v="${n}">${n}</button>`).join('')}</div>
      ${sh.allowUndo ? '<button class="btn block" data-action="pick-undone">Mark as not done</button>' : ''}
      ${sh.allowDelete ? '<button class="btn danger block" data-action="pick-delete">Delete this set</button>' : ''}`;
  } else if (sh.kind === 'restwarn') {
    body = `<h3>${esc(sh.text)}</h3>
      <p class="why center">Your next session is due ${fmtDue(sh.due)} — if you train now, the next due day is worked out from today.</p>
      <button class="btn primary big block" data-action="train-anyway">Train anyway</button>`;
  } else if (sh.kind === 'preview') {
    const st = L.blockStatus(S.workouts, S.settings);
    if (st.done) {
      body = `<h3>${esc(L.programFor(st.next).sessionName(sh.idx))} · ${fmtDue(sh.date)}</h3>
        <p class="why center">Set up the ${esc(L.programFor(st.next).name)} first; its weights come from the block start screen.</p>`;
    } else {
      const plan = L.planSession(sh.idx, S.workouts, S.settings);
      body = `<h3>${esc(plan.name)} · ${fmtDue(sh.date)}</h3>
        <p class="note-warn">Planned — weights can change after your next sessions.</p>
        ${plan.lifts
          .map(
            (l) => `<div class="plan-lift"><div class="plan-row"><span class="lift-name">${liftName(l.lift)}</span>
              <span class="plan-sets">${liftPlanText(l)}</span></div>
              ${l.notes.map((n) => `<p class="why">${esc(n)}</p>`).join('')}</div>`
          )
          .join('')}`;
    }
  } else if (sh.kind === 'presets') {
    body = `<h3>Add to this home session</h3>
      <div class="sess-list">${H.PRESETS.map(
        (p) => `<button class="sess" data-action="preset-add" data-v="${p.id}"><span><div class="nm">${esc(p.name)}</div><div class="ds">${esc(p.about)}</div></span></button>`
      ).join('')}</div>
      <p class="why">You can add more than one, e.g. Simple &amp; Sinister plus a plank.</p>`;
  } else if (sh.kind === 'homeset') {
    const it = S.home.items[sh.i];
    const m = H.MOVES[it.move];
    const ladders = m.kind === 'ladders';
    const val = ladders ? it.ladders[sh.si].top : m.kind === 'secs' ? it.sets[sh.si].secs : it.sets[sh.si].reps;
    const shown = ladders ? H.rungText(val) : m.kind === 'secs' ? `${val} s` : `${val} reps`;
    const big = it.move === 'swings' ? [-10, -1, 1, 10] : [-1, 1];
    body = `<h3>${esc(m.named ? it.name || 'Custom' : m.name)} — ${ladders ? 'ladder' : 'set'} ${sh.si + 1}</h3>
      <p class="big-num center">${shown}</p>
      <div class="btn-row">${big.map((d) => `<button class="btn big" data-action="hs-val" data-v="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`).join('')}</div>
      <button class="btn danger block" data-action="hs-del">Delete this ${ladders ? 'ladder' : 'set'}</button>`;
  } else if (sh.kind === 'tough') {
    const e = cur().lifts[sh.li];
    body = `<h3>${liftName(e.lift)} 3×5 at ${kg(e.groups[0].weight)} kg — was this tough?</h3>
      <p class="why center">If it was, ${liftName(e.lift).toLowerCase()} moves on to triples (3×3) next time.</p>
      <div class="btn-row"><button class="btn primary big" data-action="tough-ans" data-v="1">Yes, tough</button>
      <button class="btn big" data-action="tough-ans" data-v="0">No</button></div>`;
  } else if (sh.kind === 'session') {
    const next = L.nextSessionIndex(S.workouts, S.settings);
    const program = curProgram();
    body = `<h3>${sh.purpose === 'reset' ? 'Which session is next?' : 'Pick a session for today'}</h3>
      <div class="sess-list">${program.sessions
        .map(
          (s, i) => `<button class="sess ${i === next ? 'cur' : ''}" data-action="pick-session-i" data-v="${i}">
          <span class="n">${i + 1}</span><span><div class="nm">${esc(program.sessionName(i))}</div><div class="ds">${
            program.kind === '5x5' ? (s.day === 'A' ? 'Squat, bench · ' : 'Deadlift, overhead press · ') : ''
          }${esc(program.setsText(i))}</div></span>${i === next ? '<span class="tag">NEXT</span>' : ''}</button>`
        )
        .join('')}</div>
      ${sh.purpose === 'home' ? '<p class="why">After you log it, the sequence carries on from the session you did.</p>' : ''}`;
  } else if (sh.kind === 'finish') {
    // One tap anywhere closes it.
    return `<div class="sheet-backdrop" data-action="sheet-close"></div>
      <div class="sheet finish-card" role="dialog" aria-modal="true" data-action="sheet-close">${finishCardHtml(sh)}
      <p class="why center">Tap to close</p></div>`;
  }
  const closeLabel = sh.kind === 'preview' ? 'Close' : 'Cancel';
  return `<div class="sheet-backdrop" data-action="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true">${body}<button class="btn block" data-action="sheet-close">${closeLabel}</button></div>`;
}

// ---------------------------------------------------------------- events

let lp = null;
let lpUpAt = 0;
let lpFired = false;

document.addEventListener('pointerdown', (ev) => {
  const el = ev.target.closest('[data-set]');
  if (!el) return;
  lp = {
    x: ev.clientX,
    y: ev.clientY,
    t: setTimeout(() => {
      lp = null;
      lpFired = true;
      try {
        navigator.vibrate && navigator.vibrate(15);
      } catch (e) {}
      openRepsPicker(el.dataset.set);
    }, 450),
  };
});
document.addEventListener('pointermove', (ev) => {
  if (lp && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > 10) {
    clearTimeout(lp.t);
    lp = null;
  }
  if (ev.target.closest && ev.target.closest('.chart-hit')) showTip(ev);
});
const endPress = () => {
  if (lp) {
    clearTimeout(lp.t);
    lp = null;
  }
  if (lpFired) {
    lpFired = false;
    lpUpAt = Date.now();
  }
};
document.addEventListener('pointerup', endPress);
document.addEventListener('pointercancel', endPress);
document.addEventListener('contextmenu', (ev) => {
  if (ev.target.closest('[data-set]')) ev.preventDefault();
});

document.addEventListener('click', async (ev) => {
  if (Date.now() - lpUpAt < 500 || lpFired) {
    ev.preventDefault();
    return;
  }
  if (ev.target.closest('.chart-hit')) return showTip(ev);
  const setEl = ev.target.closest('[data-set]');
  if (setEl) {
    ensureAudio();
    return tapSet(setEl.dataset.set);
  }
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const v = el.dataset.v;
  const d = cur();
  ensureAudio();

  switch (a) {
    case 'tab':
      return go(v);
    case 'start':
    {
      if (S.draft && !confirm('You have a workout in progress. Throw it away and start a new one?')) return;
      const sc = L.schedule(S.workouts, S.settings);
      const idx = S.homePick ?? sc.next;
      if (sc.isRestDay) {
        S.sheet = { kind: 'restwarn', idx, text: sc.warning, due: sc.due };
        return render();
      }
      return startWorkout(idx);
    }
    case 'train-anyway':
      return startWorkout(S.sheet.idx);
    case 'resume':
      S.edit = null;
      return go('workout');
    case 'pick-session':
      S.sheet = { kind: 'session', purpose: 'home' };
      return render();
    case 'seq-pick':
      S.sheet = { kind: 'session', purpose: 'reset' };
      return render();
    case 'unpick':
      S.homePick = null;
      return render();
    case 'pick-session-i': {
      const i = +v;
      if (S.sheet.purpose === 'reset') {
        S.settings.sequenceReset = { at: new Date().toISOString(), index: i, block: L.currentBlock(S.settings).id };
        await saveSettings();
        toast(`Next session set to ${curProgram().sessionName(i)}`);
      } else S.homePick = i === L.nextSessionIndex(S.workouts, S.settings) ? null : i;
      S.sheet = null;
      return render();
    }
    case 'sheet-close':
      S.sheet = null;
      return render();
    case 'pick-reps': {
      const r = resolveSet(S.sheet.path);
      const wasDone = r.set.done;
      r.set.reps = +v;
      if (r.kind !== 'extra') r.set.done = true;
      if (!wasDone && r.kind !== 'extra') startRest();
      S.sheet = null;
      touched();
      return render();
    }
    case 'pick-undone': {
      const r = resolveSet(S.sheet.path);
      r.set.done = false;
      r.set.reps = r.target;
      S.sheet = null;
      touched();
      return render();
    }
    case 'pick-delete': {
      const r = resolveSet(S.sheet.path);
      r.list.splice(r.index, 1);
      S.sheet = null;
      touched();
      return render();
    }
    case 'backup-later':
      S.settings.backupSnoozeUntil = new Date(Date.now() + 3 * DAY).toISOString();
      await saveSettings();
      return render();
    case 'export':
      return exportBackup();
    case 'update-app':
      if (S.updateWorker) {
        updating = true;
        S.updateWorker.postMessage({ type: 'SKIP_WAITING' });
      }
      return;

    // --- blocks
    case 'block-setup':
      return openBlockSetup();
    case 'bd-len':
      S.blockDraft.length = +v;
      return render();
    case 'block-start': {
      const b = S.blockDraft;
      try {
        S.settings = L.startBlock(S.settings, S.workouts, b);
      } catch (err) {
        return toast(err.message || String(err));
      }
      await saveSettings();
      S.blockDraft = null;
      S.homePick = null;
      go('home');
      return toast(`${L.programFor(b.kind).name} started`);
    }
    case 'switch-block': {
      const np = L.programFor(L.blockStatus(S.workouts, S.settings).next).name;
      if (!confirm(`End the current block now and switch to the ${np}?\n\nAll your logged workouts are kept. You can go back if this was a mistake (until you log a workout in the new block).`))
        return;
      S.settings = L.switchBlockNow(S.settings);
      await saveSettings();
      go('home');
      return toast(`Set up the ${np} on Home`);
    }
    case 'undo-switch':
      if (!confirm('Go back to the previous block?')) return;
      S.settings = L.undoSwitch(S.workouts, S.settings);
      await saveSettings();
      render();
      return toast('Back to the previous block');
    case 'tough-set': {
      const e = d.lifts[+el.dataset.path];
      e.tough = v === '1';
      touched();
      return render();
    }
    case 'tough-ans': {
      cur().lifts[S.sheet.li].tough = v === '1';
      S.sheet = null;
      touched();
      return finishWorkout();
    }
    case 'a-add': {
      const e = d.lifts[+v];
      e.attempts = e.attempts || [];
      const prev = e.attempts[e.attempts.length - 1];
      e.attempts.push({ weight: prev ? prev.weight : e.oneRM || 0, reps: 1, clean: true });
      if (e.attempts.length > 1) startRest();
      touched();
      return render();
    }
    case 'a-reps':
    case 'a-clean':
    case 'a-remove': {
      const [li, i] = el.dataset.path.split('.').map(Number);
      const list = d.lifts[li].attempts;
      if (a === 'a-reps') list[i].reps = +v;
      else if (a === 'a-clean') list[i].clean = list[i].clean === false;
      else list.splice(i, 1);
      touched();
      return render();
    }

    // --- logging
    case 'w-step': {
      const t = weightTarget(el.dataset.path);
      t.obj.weight = Math.max(0, Math.round((Number(t.obj.weight || 0) + Number(el.dataset.dir) * t.step) * 1000) / 1000);
      afterWeightChange(t);
      touched();
      return render();
    }
    case 'cardio-add':
      d.cardio = { type: 'run', minutes: null, distance: null, unit: 'km' };
      touched();
      return render();
    case 'cardio-remove':
      d.cardio = null;
      touched();
      return render();
    case 'cardio-set':
      d.cardio[el.dataset.path] = v;
      touched();
      return render();
    case 'pu-add':
      d.pullups = P.newPullupRecord(puState(), lastFreePullups());
      touched();
      return render();
    case 'pu-remove':
      d.pullups = null;
      touched();
      return render();
    case 'pu-addset':
    case 'pu-test': {
      const rec = v === 'gym' ? d.pullups : S.home.items[+v];
      if (a === 'pu-addset') {
        const last = rec.sets[rec.sets.length - 1];
        rec.sets.push({ reps: last ? last.reps : 1, done: false });
      } else {
        Object.assign(rec, { mode: 'test', ladder: null, sets: [{ reps: puState().max || 1, done: false }] });
      }
      touched();
      return render();
    }
    case 'pu-setup': {
      const ps = puState();
      S.puSetup = { max: ps.phase === 'setup' ? 5 : ps.max, kg: ps.kg || 0, back: S.view };
      return go('pusetup');
    }
    case 'pus-step': {
      const f = el.dataset.path;
      S.puSetup[f] = Math.max(0, Math.round((S.puSetup[f] + +v) * 100) / 100);
      return render();
    }
    case 'pus-back': {
      const back = S.puSetup?.back || 'settings';
      S.puSetup = null;
      return go(back);
    }
    case 'pus-save': {
      const u = S.puSetup;
      if (S.settings.pullups && !confirm('Start the pull-up program again from this max? Your logged pull-ups are kept.')) return;
      const prev = S.settings.pullups;
      const first = prev ? prev.first || { max: prev.max, kg: prev.kg || 0, at: prev.at } : null;
      S.settings.pullups = { max: u.max, kg: u.kg || 0, at: new Date().toISOString(), ...(first ? { first } : {}) };
      await saveSettings();
      // A home session waiting for the setup gets today's pull-ups now.
      if (S.home) {
        const st = puState();
        S.home.items = S.home.items.map((it) => (it.move === 'pullups' && !it.mode ? { move: 'pullups', ...P.newPullupRecord(st, lastFreePullups()) } : it));
      }
      const back = u.back || 'settings';
      S.puSetup = null;
      go(back);
      return toast(`Pull-ups: ${P.pickProgram(u.max).name}`);
    }

    // --- home sessions
    case 'home-open':
      return openHome(v);
    case 'home-continue':
      return openSavedHome(v);
    case 'fed': {
      const want = v === '1';
      d.fed = d.fed === want ? undefined : want; // tap again to clear
      touched();
      return render();
    }
    case 'bw-new':
      return openBodyweight();
    case 'bw-step':
      S.bw.kg = B.roundBw(Math.max(0, Number(S.bw.kg) + +v));
      return render();
    case 'bw-save':
      return saveBodyweight();
    case 'bw-back': {
      const back = S.bw && S.bw._editing ? 'history' : S.bwBack === 'progress' ? 'progress' : 'home';
      S.bw = null;
      return go(back);
    }
    case 'bw-delete':
      if (!confirm('Delete this bodyweight entry?')) return;
      S.workouts = S.workouts.filter((w) => w.id !== S.bw.id);
      await saveWorkouts();
      S.bw = null;
      go('history');
      return toast('Entry deleted');
    case 'up-more':
      S.upMore = !S.upMore;
      return render();
    case 'up-preview':
      S.sheet = { kind: 'preview', idx: +el.dataset.idx, date: el.dataset.date };
      return render();
    case 'home-add':
      S.sheet = { kind: 'presets' };
      return render();
    case 'preset-add':
      addPreset(v);
      S.sheet = null;
      return render();
    case 'item-remove':
      S.home.items.splice(+v, 1);
      touched();
      return render();
    case 'wu-done':
      S.home.items[+v].done = !S.home.items[+v].done;
      touched();
      return render();
    case 'wu-rounds':
      S.home.items[+el.dataset.path].rounds = +v;
      touched();
      return render();
    case 'q-sets':
    case 'q-reps': {
      const it = S.home.items[+el.dataset.path];
      const m = H.MOVES[it.move];
      const list = m.kind === 'ladders' ? it.ladders : it.sets;
      const planned = list.filter((x) => !x.time);
      const key = m.kind === 'ladders' ? 'top' : m.kind === 'secs' ? 'secs' : 'reps';
      if (a === 'q-sets') {
        if (+v > 0) {
          const src = planned[planned.length - 1] || list[list.length - 1] || { [key]: m.kind === 'secs' ? 10 : 1 };
          const { time, ...copy } = src;
          list.splice(planned.length, 0, copy); // planned sets stay before practice sets
        } else if (planned.length > 1) {
          list.splice(list.indexOf(planned[planned.length - 1]), 1);
        }
      } else {
        for (const x of planned) x[key] = Math.max(1, Math.min(key === 'top' ? 10 : 1000, x[key] + +v));
      }
      touched();
      return render();
    }
    case 'hs-add':
      H.addSet(S.home.items[+v]);
      touched();
      render();
      return toast('Set added');
    case 'hs-edit': {
      const [i, si] = el.dataset.path.split('.').map(Number);
      S.sheet = { kind: 'homeset', i, si };
      return render();
    }
    case 'hs-val':
    case 'hs-del': {
      const { i, si } = S.sheet;
      const it = S.home.items[i];
      const m = H.MOVES[it.move];
      const list = m.kind === 'ladders' ? it.ladders : it.sets;
      const key = m.kind === 'ladders' ? 'top' : m.kind === 'secs' ? 'secs' : 'reps';
      if (a === 'hs-del') {
        list.splice(si, 1);
        S.sheet = null;
      } else list[si][key] = Math.max(1, Math.min(key === 'top' ? 10 : 1000, list[si][key] + +v));
      touched();
      return render();
    }
    case 'home-save':
      return saveHome();
    case 'home-back': {
      if (S.homeDirty && !confirm('Leave without saving this home session?')) return;
      const back = S.homeBack === 'history' ? 'history' : 'home';
      S.home = null;
      return go(back);
    }
    case 'home-delete':
      if (!confirm('Delete this home session?')) return;
      S.workouts = S.workouts.filter((w) => w.id !== S.home.id);
      await saveWorkouts();
      S.home = null;
      go(S.homeBack === 'history' ? 'history' : 'home');
      return toast('Session deleted');
    case 'x-add':
      d.extras = d.extras || [];
      d.extras.push({ name: '', weight: 10, sets: [{ reps: 10, done: true }] });
      touched();
      render();
      {
        const inputs = $app.querySelectorAll('[data-bind^="extras."][data-bind$=".name"]');
        inputs[inputs.length - 1]?.focus();
      }
      return;
    case 'x-addset': {
      const x = d.extras[+v];
      const lastReps = x.sets.length ? x.sets[x.sets.length - 1].reps : 10;
      x.sets.push({ reps: lastReps, done: true });
      touched();
      return render();
    }
    case 'x-remove':
      d.extras.splice(+v, 1);
      touched();
      return render();
    case 't-add':
      if (S.draft?._timerEnd) {
        S.draft._timerEnd = Math.max(Date.now() + 1000, S.draft._timerEnd + +v * 1000);
        S.draft._timerTotal = Math.max(1, (S.draft._timerTotal || 180) + +v);
        S.draft._timerRang = false;
        saveDraftSoon();
        tickTimer();
      }
      return;
    case 't-skip':
      return stopRest();
    case 'w-back':
      if (S.edit) {
        if (S.editDirty && !confirm('Leave without saving your changes?')) return;
        S.edit = null;
        return go('history');
      }
      return go('home');
    case 'w-finish':
      return finishWorkout();
    case 'w-discard':
      if (!confirm('Throw away this workout? Nothing from it will be saved.')) return;
      S.draft = null;
      await db.set('draft', undefined);
      return go('home');
    case 'w-delete':
      if (!confirm('Delete this workout for good? Your plan will be recalculated without it.')) return;
      S.workouts = S.workouts.filter((w) => w.id !== S.edit.id);
      await saveWorkouts();
      S.edit = null;
      go('history');
      return toast('Workout deleted');

    // --- kettlebell
    // --- history / progress
    case 'h-open':
      return openHistory(v);
    case 'prog':
      S[el.dataset.path] = v;
      return render();

    // --- settings
    case 'set-len': {
      const n = +v;
      S.settings.block5x5Length = n;
      const cb = L.currentBlock(S.settings);
      if (cb.kind === '5x5') {
        S.settings.blocks = L.blocksOf(S.settings).map((b) => (b.id === cb.id ? { ...b, length: n } : b));
      }
      await saveSettings();
      return render();
    }
    case 'set-round':
      S.settings.rounding = +v;
      await saveSettings();
      return render();
    case 'rest-step':
      S.settings.restSeconds = Math.min(600, Math.max(15, S.settings.restSeconds + +v));
      await saveSettings();
      return render();
    case 'set-game':
      S.settings.gameMode = v === 'on';
      await saveSettings();
      return render();
    case 'set-theme':
      S.settings.theme = v;
      applyTheme();
      await saveSettings();
      return render();
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  const b = el.dataset && el.dataset.bind;
  if (!b) return;
  const val = el.dataset.num != null ? num(el.value) : el.value;
  if (b.startsWith('home:')) {
    setPath(S.home, b.slice(5), val);
    S.homeDirty = true;
  }
  else if (b.startsWith('bd:')) {
    setPath(S.blockDraft, b.slice(3), el.dataset.pct != null && val != null ? val / 100 : val);
    updateBlockStartCalcs();
  }
  else {
    setPath(cur(), b, val);
    touched();
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.dataset.weight) {
    const t = weightTarget(el.dataset.weight);
    const n = num(el.value);
    const changed = n != null && n >= 0 && n !== Number(t.obj.weight);
    if (changed) t.obj.weight = n;
    el.value = kg(t.obj.weight);
    if (changed) {
      afterWeightChange(t);
      if (t.obj.role === 'top') {
        // Show the back-off weight that just followed, without redrawing the screen.
        const bi = t.entry.groups.findIndex((g) => g.role === 'backoff');
        const box = $app.querySelector(`[data-weight="${el.dataset.weight.replace(/\.\d+$/, '.' + bi)}"]`);
        if (box) box.value = kg(t.entry.groups[bi].weight);
      }
    }
    touched();
    return;
  }
  if (el.matches('[data-date]')) {
    const d = cur();
    const iso = fromLocalInput(el.value);
    if (iso) {
      d.date = iso;
      d._dateTouched = true;
      touched();
    }
    return;
  }
  if (el.matches('[data-name]')) {
    S.settings.name = el.value.trim().slice(0, 40);
    await saveSettings();
    return toast('Name saved');
  }
  if (el.matches('[data-bw]')) {
    const n = num(el.value);
    if (n != null && n > 0) S.bw.kg = B.roundBw(n);
    el.value = B.roundBw(S.bw.kg).toFixed(1);
    return;
  }
  if (el.matches('[data-bwdate]')) {
    const iso = fromLocalInput(el.value);
    if (iso) {
      S.bw.date = iso;
      S.bw._dateTouched = true;
    }
    return;
  }
  if (el.dataset.hdur) {
    const [i, part] = el.dataset.hdur.split('.');
    const it = S.home.items[+i];
    const box = (p) => $app.querySelector(`[data-hdur="${i}.${p}"]`);
    const val = (p) => Math.max(0, Math.floor(num(p === part ? el.value : box(p)?.value) || 0));
    const total = val('m') * 60 + val('s');
    if (total > 0) it.durationSec = total;
    else delete it.durationSec;
    if (box('m')) box('m').value = total > 0 ? Math.floor(total / 60) : '';
    if (box('s')) box('s').value = total > 0 ? String(total % 60).padStart(2, '0') : '';
    S.homeDirty = true;
    return;
  }
  if (el.matches('[data-homedate]')) {
    const iso = fromLocalInput(el.value);
    if (iso) {
      S.home.date = iso;
      S.home._dateTouched = true;
      S.homeDirty = true;
    }
    return;
  }
  if (el.dataset.setw) {
    const [lift, field] = el.dataset.setw.split('.');
    const n = num(el.value);
    if (n == null || n < 0 || (field === 'increment' && n === 0)) {
      toast('Please type a number, e.g. 82.5');
      return render();
    }
    S.settings = L.editWeight(S.settings, S.workouts, lift, field, n);
    await saveSettings();
    render();
    const shown = L.currentWeights(S.workouts, S.settings)[lift][field];
    toast(field !== 'increment' && shown !== n ? `Saved — rounds to ${kg(shown)} kg with your rounding step` : 'Saved — used from your next workout');
    return;
  }
  if (el.dataset.tf) {
    const field = el.dataset.tf; // startPct | stepPct
    const [lo, hi] = field === 'startPct' ? L.TF_START_RANGE : L.TF_STEP_RANGE;
    const n = num(el.value);
    if (n == null || n / 100 < lo - 1e-9 || n / 100 > hi + 1e-9) {
      toast(`Please enter a number from ${L.fmtPct(lo)} to ${L.fmtPct(hi)}`);
      return render();
    }
    const key = field === 'startPct' ? 'tfStartPct' : 'tfStepPct';
    S.settings[key] = n / 100;
    const cb = L.currentBlock(S.settings);
    if (cb.kind === '3-5') {
      S.settings.blocks = L.blocksOf(S.settings).map((b) => (b.id === cb.id ? { ...b, [field]: n / 100 } : b));
    }
    await saveSettings();
    render();
    return toast('Saved');
  }
  if (el.matches('[data-import]')) return importBackup(el);
});

document.addEventListener('keydown', (ev) => {
  // Enter in a number box = done typing (closes the iPhone keyboard).
  if (ev.key === 'Enter' && ev.target.matches('input[type="text"]')) ev.target.blur();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    wakeLock = null;
    keepAwake(S.view === 'workout' && !S.edit && !!S.draft);
    tickTimer();
  }
});

// ---------------------------------------------------------------- service worker (offline + updates)

let updating = false;
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const offer = (w) => {
        S.updateWorker = w;
        if (S.view === 'home' || S.view === 'settings') render();
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Service worker not registered', e));
}

// ---------------------------------------------------------------- start

async function boot() {
  try {
    const [settings, workouts, draft] = await Promise.all([db.get('settings'), db.get('workouts'), db.get('draft')]);
    S.settings = L.mergeSettings(settings);
    S.workouts = Array.isArray(workouts) ? workouts : [];
    S.draft = draft || null;
    if (!settings) await saveSettings();
    applyTheme();
    render();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<main class="wrap"><div class="card"><h3>Something went wrong while loading</h3><p class="why">${esc(e.message || e)}</p>
      <p class="why">Your data is not deleted. Try closing and reopening the app.</p></div></main>`;
    return;
  }
  db.persist().then((ok) => {
    S.persisted = ok;
    if (S.view === 'settings') render();
  });
  registerSW();
}

boot();
