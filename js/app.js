// Strength Log — screens and interaction.
import * as L from './logic.js';
import * as db from './db.js';

// Keep in step with CACHE_VERSION in sw.js (bump both when releasing changes).
const APP_VERSION = '3.0.0';

const $app = document.getElementById('app');
const $timer = document.getElementById('timer');
const $toast = document.getElementById('toast');

const S = {
  settings: L.defaultSettings(),
  workouts: [],
  draft: null, // new gym workout in progress (saved to the phone as you go)
  edit: null, // copy of a past gym workout being edited
  editDirty: false,
  kb: null, // home kettlebell session being logged or edited
  view: 'home',
  homePick: null, // session picked by hand on Home
  sheet: null, // open bottom sheet
  progressLift: 'squat',
  progressType: 'all',
  blockDraft: null, // values on the block start screen
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
    kb: viewKb,
    blockstart: viewBlockStart,
  };
  const showTabs = !['workout', 'kb', 'blockstart'].includes(S.view);
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
        <button class="link" data-action="kb-new">Optional: home Simple &amp; Sinister ›</button>
      </section>`
    : '';

  const upcoming = `<section class="card">
      <h3>Coming up</h3>
      <div class="upcoming">${sc.upcoming
        .map((u) => `<div class="up-row"><span class="up-date">${fmtDue(u.date)}</span><span>${esc(u.name)}</span></div>`)
        .join('')}</div>
      <p class="why">If you train on each due day, with a rest day in between. Moves with you when you log.</p>
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
      <div class="plan-lift opt"><div class="plan-row"><span class="lift-name">Pull-ups</span><span class="plan-sets">optional · 3×5</span></div></div>
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
    ${updateBanner()}${resume}${backup}${rest}
    ${main}
    ${upcoming}
    <button class="card kb-btn" data-action="kb-new">
      <div><div class="k1">Home — Simple &amp; Sinister</div><div class="k2">Kettlebell swings &amp; get-ups · doesn't change the gym plan</div></div>
      <span class="chev">›</span>
    </button>
    <p class="muted center small">${
      last
        ? `Last gym session: ${esc(L.workoutTitle(last))} · ${fmtDate(last.date)} (${daysAgo(last.date)})`
        : 'No workouts yet. Tap Start when you get to the gym.'
    }</p>
  </main>`;
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
  if (!d.pullups) return `<button class="add" data-action="pu-add">+ Pull-ups 3×5 (bodyweight)</button>`;
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
  if (p[0] === 'p') return { set: d.pullups.sets[+p[1]], target: L.REPS, kind: 'pullup', title: 'Pull-ups' };
  const x = d.extras[+p[1]];
  return { set: x.sets[+p[2]], target: null, kind: 'extra', title: x.name || 'Extra exercise', list: x.sets, index: +p[2] };
}

function touched() {
  if (S.edit) S.editDirty = true;
  else saveDraftSoon();
}

function tapSet(path) {
  const r = resolveSet(path);
  if (r.kind === 'extra') return openRepsPicker(path);
  const s = r.set;
  if (!s.done) {
    s.done = true;
    s.reps = r.target;
    startRest();
  } else if (s.reps > 0) s.reps -= 1;
  else {
    s.done = false;
    s.reps = r.target;
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
  w.extras = (w.extras || []).filter((x) => (x.name || '').trim() || x.sets.length);
  for (const k of Object.keys(w)) if (k.startsWith('_')) delete w[k];

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

// ---------------------------------------------------------------- kettlebell

function newKb() {
  const prev = L.sortByDate(S.workouts.filter((w) => w.kind === 'home')).pop();
  S.kb = {
    id: L.makeId(),
    kind: 'home',
    date: null,
    swings: prev ? { ...prev.swings } : { reps: 100, kg: 20 },
    getups: prev ? { ...prev.getups } : { reps: 10, kg: 20 },
    minutes: null,
    notes: '',
  };
  go('kb');
}

function kbStepper(path, step, unit) {
  const v = getPath(S.kb, path);
  return `<div class="stepper">
    <button class="step" data-action="kb-step" data-path="${path}" data-v="${-step}" aria-label="Less">−</button>
    <input class="wt" type="text" inputmode="decimal" data-bind="kb:${path}" data-num value="${v ?? ''}">
    <span class="unit">${unit}</span>
    <button class="step" data-action="kb-step" data-path="${path}" data-v="${step}" aria-label="More">+</button>
  </div>`;
}

function viewKb() {
  const k = S.kb;
  const editing = !!k._editing;
  return `<header class="top bar">
      <button class="btn ghost" data-action="kb-back">‹ ${editing ? 'Back' : 'Home'}</button>
      <div class="title"><div class="t">Home — S&amp;S</div><div class="sub">${editing ? 'Editing · ' + fmtDate(k.date) : 'Kettlebell'}</div></div>
      <button class="btn primary sm" data-action="kb-save">Save</button>
    </header>
    <main class="wrap">
      <section class="card"><h3>Swings</h3>
        <div class="group-head"><span class="glabel">Total reps</span>${kbStepper('swings.reps', 10, 'reps')}</div>
        <div class="group-head"><span class="glabel">Bell</span>${kbStepper('swings.kg', 4, 'kg')}</div>
      </section>
      <section class="card"><h3>Get-ups</h3>
        <div class="group-head"><span class="glabel">Total reps</span>${kbStepper('getups.reps', 1, 'reps')}</div>
        <div class="group-head"><span class="glabel">Bell</span>${kbStepper('getups.kg', 4, 'kg')}</div>
      </section>
      <section class="card">
        <label class="lbl" for="kbmin">Time (minutes, optional)</label>
        <input id="kbmin" type="text" inputmode="decimal" data-bind="kb:minutes" data-num value="${k.minutes ?? ''}" placeholder="e.g. 25">
        <label class="lbl" for="kbnotes">Notes</label>
        <textarea id="kbnotes" data-bind="kb:notes" rows="2">${esc(k.notes)}</textarea>
        <label class="lbl" for="kbdate">Date &amp; time</label>
        <input id="kbdate" type="datetime-local" data-kbdate value="${toLocalInput(k.date)}">
      </section>
      <button class="btn primary big block" data-action="kb-save">Save session</button>
      ${editing ? '<button class="btn danger block" data-action="kb-delete">Delete this session</button>' : ''}
    </main>`;
}

async function saveKb() {
  const k = clone(S.kb);
  const editing = !!k._editing;
  if (!editing) {
    k.date = k._dateTouched && k.date ? k.date : new Date().toISOString();
    k.createdAt = Date.now();
  } else k.updatedAt = Date.now();
  for (const key of Object.keys(k)) if (key.startsWith('_')) delete k[key];
  if (editing) S.workouts = S.workouts.map((x) => (x.id === k.id ? k : x));
  else S.workouts.push(k);
  await saveWorkouts();
  S.kb = null;
  go(editing ? 'history' : 'home');
  toast('Kettlebell session saved');
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

function summary(w) {
  if (w.kind === 'home') {
    const p = [];
    if (w.swings) p.push(`Swings ${w.swings.reps} × ${kg(w.swings.kg)} kg`);
    if (w.getups) p.push(`Get-ups ${w.getups.reps} × ${kg(w.getups.kg)} kg`);
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
  if (w.pullups) parts.push(`Pull-ups ${w.pullups.sets.map((s) => (s.done ? s.reps : '–')).join(',')}`);
  if (w.extras?.length) parts.push(`+${w.extras.length} extra`);
  return parts.join(' · ');
}

function viewHistory() {
  const list = L.sortByDate(S.workouts).reverse();
  let month = '';
  const rows = list
    .map((w) => {
      const m = new Date(w.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const head = m !== month ? `<div class="month">${(month = m)}</div>` : '';
      const title = w.kind === 'home' ? 'Home — Simple &amp; Sinister' : esc(L.workoutTitle(w));
      return `${head}<button class="hrow" data-action="h-open" data-v="${esc(w.id)}">
        <div class="hdate">${fmtDate(w.date)} · ${fmtTime(w.date)} ${blockTag(w)}</div>
        <div class="htitle">${title}</div>
        <div class="hsum">${esc(summary(w))}</div></button>`;
    })
    .join('');
  return `<header class="top"><h1>History</h1></header>
    <main class="wrap">${rows || '<p class="muted center">No workouts yet. Finished workouts show up here — tap one to see or edit it.</p>'}</main>`;
}

function openHistory(id) {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return;
  if (w.kind === 'home') {
    S.kb = { ...clone(w), _editing: true };
    go('kb');
  } else {
    S.edit = { ...clone(w), _editing: true };
    S.editDirty = false;
    go('workout');
  }
}

// ---------------------------------------------------------------- progress

let chartPts = [];

function niceStep(range) {
  for (const s of [1, 2.5, 5, 10, 20, 25, 50, 100]) if (range / s <= 5) return s;
  return 200;
}

function chartSvg(points) {
  const W = 340,
    H = 210,
    pl = 40,
    pr = 14,
    pt = 34,
    pb = 26;
  const vals = points.map((p) => p.top);
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (hi - lo < 10) {
    lo -= 5;
    hi += 5;
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const t0 = Date.parse(points[0].date),
    t1 = Date.parse(points[points.length - 1].date);
  const x = (t) => (t1 === t0 ? pl + (W - pl - pr) / 2 : pl + ((t - t0) / (t1 - t0)) * (W - pl - pr));
  const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  chartPts = points.map((p) => ({ ...p, cx: x(Date.parse(p.date)), cy: y(p.top) }));

  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${kg(v)}</text>`;
  }
  const xl = (p, anchor) =>
    `<text x="${p.cx}" y="${H - 6}" text-anchor="${anchor}" font-size="11" fill="var(--muted)">${new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`;
  const first = chartPts[0],
    last = chartPts[chartPts.length - 1];
  const path = chartPts.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
  const dots = chartPts
    .map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="4.5" fill="var(--chart)" stroke="var(--surface)" stroke-width="2"/>`)
    .join('');
  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top set weight over time">
      ${grid}
      <path d="${path}" fill="none" stroke="var(--chart)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="xhair" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
      ${dots}
      ${xl(first, chartPts.length > 1 ? 'start' : 'middle')}${chartPts.length > 1 ? xl(last, 'end') : ''}
      <rect class="chart-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div></div>`;
}

function showTip(ev) {
  const hit = ev.target.closest('.chart-hit');
  if (!hit || !chartPts.length) return;
  const svg = hit.ownerSVGElement;
  const box = svg.getBoundingClientRect();
  const vx = ((ev.clientX - box.left) / box.width) * 340;
  let best = chartPts[0];
  for (const p of chartPts) if (Math.abs(p.cx - vx) < Math.abs(best.cx - vx)) best = p;
  const tip = svg.parentElement.querySelector('.chart-tip');
  const xh = svg.querySelector('.xhair');
  xh.setAttribute('x1', best.cx);
  xh.setAttribute('x2', best.cx);
  xh.setAttribute('visibility', 'visible');
  const sets = best.sets.map((s) => `${kg(s.weight)}×${s.reps}`).join(', ');
  tip.innerHTML = `<b>${kg(best.top)} kg</b> · ${fmtDate(best.date)} · ${L.TYPE_LABEL[best.type] || ''}${best.deload ? ' (deload)' : ''}<br><span class="muted">${esc(sets)}</span>`;
  tip.hidden = false;
  const px = (best.cx / 340) * box.width;
  tip.style.left = Math.min(Math.max(px, 90), box.width - 90) + 'px';
}

function viewProgress() {
  const lift = S.progressLift;
  const all = L.liftHistory(S.workouts, lift);
  const tf = ['3x5', '3x3', 'test'];
  const pts =
    S.progressType === 'all'
      ? all
      : all.filter((h) => (S.progressType === '3-5' ? tf.includes(h.type) : h.type === S.progressType));
  const best = L.bestSets(S.workouts, lift, 8);
  const rms = L.oneRMHistory(S.workouts, S.settings, lift);
  const seg = (field, opts) =>
    `<div class="seg">${opts
      .map(([v, t]) => `<button class="${S[field] === v ? 'on' : ''}" data-action="prog" data-path="${field}" data-v="${v}">${t}</button>`)
      .join('')}</div>`;
  return `<header class="top"><h1>Progress</h1></header>
    <main class="wrap">
      ${seg('progressLift', L.LIFTS.map((l) => [l.id, l.short]))}
      <section class="card">
        <h3>${liftName(lift)} · top set (kg)</h3>
        ${seg('progressType', [['all', 'All'], ['volume', 'Vol'], ['heavy', 'Heavy'], ['unload', 'Unload'], ['3-5', '3–5']])}
        ${pts.length ? chartSvg(pts) + '<p class="why">Tap the chart to see a day.</p>' : '<p class="muted">Nothing logged yet for this lift.</p>'}
      </section>
      <section class="card">
        <h3>Best sets</h3>
        ${
          best.length
            ? `<table class="best"><tbody>${best
                .map((b) => `<tr><td><b>${kg(b.weight)} kg</b> × ${b.reps}</td><td>${fmtDate(b.date, true)}</td></tr>`)
                .join('')}</tbody></table>`
            : '<p class="muted">Your heaviest sets will be listed here.</p>'
        }
      </section>
      <section class="card">
        <h3>1RMs</h3>
        ${
          rms.length
            ? `<table class="best"><tbody>${rms
                .map(
                  (r) =>
                    `<tr><td><b>${kg(r.weight)} kg</b> · ${r.source === 'tested' ? 'tested' : 'entered at block start'}</td><td>${r.date ? fmtDate(r.date, true) : ''}</td></tr>`
                )
                .join('')}</tbody></table>`
            : '<p class="muted">1RMs from the 3–5 block (entered and tested) will be listed here.</p>'
        }
      </section>
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
        <h3>Look</h3>
        ${seg('set-theme', [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match iPhone']], st.theme || 'dark')}
      </section>
      <section class="card small muted">
        <p>Strength Log ${APP_VERSION} · ${gyms} gym + ${S.workouts.length - gyms} home sessions saved on this device (${db.backend()}).
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
  }
  return `<div class="sheet-backdrop" data-action="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true">${body}<button class="btn block" data-action="sheet-close">Cancel</button></div>`;
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
      d.pullups = { sets: Array.from({ length: L.PULLUP_SETS }, () => ({ reps: L.REPS, done: false })) };
      touched();
      return render();
    case 'pu-remove':
      d.pullups = null;
      touched();
      return render();
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
    case 'kb-new':
      return newKb();
    case 'kb-step': {
      const p = el.dataset.path;
      setPath(S.kb, p, Math.max(0, (num(getPath(S.kb, p)) || 0) + +v));
      return render();
    }
    case 'kb-save':
      return saveKb();
    case 'kb-back': {
      const wasEditing = !!S.kb?._editing;
      S.kb = null;
      return go(wasEditing ? 'history' : 'home');
    }
    case 'kb-delete':
      if (!confirm('Delete this kettlebell session?')) return;
      S.workouts = S.workouts.filter((w) => w.id !== S.kb.id);
      await saveWorkouts();
      S.kb = null;
      go('history');
      return toast('Session deleted');

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
  if (b.startsWith('kb:')) setPath(S.kb, b.slice(3), val);
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
  if (el.matches('[data-kbdate]')) {
    const iso = fromLocalInput(el.value);
    if (iso) {
      S.kb.date = iso;
      S.kb._dateTouched = true;
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
