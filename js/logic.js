// Strength Log — program logic (blocks, sequence, progression, rest days, rounding).
// Pure functions only: no screen, no storage. Used by the app and by the tests.
//
// How recommendations work
// ------------------------
// Nothing is stored about "what the next weight is". Every time, the app replays
// your logged workouts (and any weight edits you made) over the starting weights.
// So editing or deleting an old workout automatically recalculates everything, and
// what you ACTUALLY lifted always wins.
//
// Blocks and programs
// -------------------
// Training rotates through blocks: 5×5 block → 3–5 block → 5×5 block → …
// settings.blocks lists the blocks you've started; the last one is the current one.
// Each gym workout is tagged with the block it was logged in (workouts from before
// blocks existed belong to the first block). Block progress counts workouts, never dates.
// Each block kind has a program object (PAVEL_5X5, PAVEL_3_5). To add another block
// later (e.g. Power to the People!), write a program object for it, add it to
// PROGRAM_BY_KIND and put its kind in BLOCK_ROTATION.

export const LIFTS = [
  { id: 'squat', name: 'Squat', short: 'Squat', tag: 'squat' },
  { id: 'bench', name: 'Bench press', short: 'Bench', tag: 'bench' },
  { id: 'deadlift', name: 'Deadlift', short: 'Deadlift', tag: 'deadlift' },
  { id: 'ohp', name: 'Overhead press', short: 'OHP', tag: 'OHP' },
];
export const LIFT_BY_ID = Object.fromEntries(LIFTS.map((l) => [l.id, l]));

export const REPS = 5;
export const VOLUME_SETS = 5;
export const UNLOAD_SETS = 5;
export const UNLOAD_REPS = 4;
export const UNLOAD_FACTOR = 0.8; // unload = 80% of the 5×5 weight lifted that cycle
export const BACKOFF_FACTOR = 0.9; // back-off set = heavy top set − 10%
export const HEAVY_DROP_FACTOR = 0.9; // heavy −10% after two missed top sets in a row
export const HEAVY_MISSES_BEFORE_DROP = 2;
export const PULLUP_SETS = 3;
export const REST_DAYS = 1; // full rest days between gym sessions
export const LONG_BREAK_DAYS = 14;

export const BLOCK_LENGTHS = [18, 24, 30, 36]; // 5×5 block length, whole cycles only
export const TF_START_RANGE = [0.65, 0.7]; // 3–5 block: first session % of 1RM
export const TF_STEP_RANGE = [0.02, 0.03]; // 3–5 block: added % of 1RM each session
export const TF_TRIPLE_SESSIONS = 2; // 3×3 sessions before the 1RM test

// Old (v1) data used "light" for what is now the unload day.
const TYPE_ALIAS = { light: 'unload' };
export function normType(t) {
  return TYPE_ALIAS[t] || t;
}

// ---------- numbers ----------

function clean(x) {
  return Math.round(Number(x) * 1000) / 1000;
}

/** Round to the nearest step; exact ties round DOWN (78.75 → 77.5 with step 2.5). */
export function roundTo(x, step) {
  if (!(step > 0)) return clean(x);
  return clean(Math.ceil(Number(x) / step - 0.5 - 1e-9) * step);
}

export function fmtKg(x) {
  return String(clean(x));
}

export function fmtPct(f) {
  return String(Math.round(f * 1000) / 10);
}

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function ts(d) {
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function sortByDate(workouts) {
  return [...workouts].sort(
    (a, b) => ts(a.date) - ts(b.date) || (a.createdAt || 0) - (b.createdAt || 0)
  );
}

function setReps(g) {
  return (g.sets || []).map((x) => (x.done ? x.reps | 0 : 0));
}

function anyDone(g) {
  return !!g && (g.sets || []).some((x) => x.done);
}

function repsText(reps) {
  return reps.join(',');
}

function groupOf(entry, role) {
  const gs = entry.groups || [];
  return gs.find((g) => g.role === role) || (role === 'work' ? gs[0] : undefined);
}

/** Heaviest clean attempt in a 1RM test (any clean attempt with 1+ reps counts as a single). */
export function bestCleanSingle(attempts) {
  const ok = (attempts || []).filter((a) => a && a.clean !== false && (a.reps | 0) >= 1 && Number(a.weight) > 0);
  return ok.length ? Math.max(...ok.map((a) => Number(a.weight))) : null;
}

// =====================================================================================
// 5×5 block: volume / heavy / unload
// =====================================================================================

const VOLUME = {
  label: 'Volume',
  setsText: '5×5 at volume weight',
  plan(s, ctx) {
    return {
      groups: [{ role: 'work', label: '5×5', weight: ctx.r(s.volume), target: REPS, sets: VOLUME_SETS }],
      notes: [volumeNote(s, ctx)],
    };
  },
  apply(s, entry, ctx) {
    if (entry.deload) return; // v1 deload days stay in history but don't count under the current rules
    const g = groupOf(entry, 'work');
    if (!anyDone(g)) return;
    const w = Number(g.weight);
    const reps = setReps(g);
    const full = reps.filter((r) => r >= REPS).length >= VOLUME_SETS;
    s.volume = clean(full ? w + ctx.inc : w); // the raised weight applies from the next volume day
    s.cycleVolume = w; // this cycle's unload is 80% of what was actually lifted today
    s.lastVolume = { weight: w, reps, success: full };
    s.src.volume = 'log';
  },
};

const HEAVY = {
  label: 'Heavy',
  setsText: '1×5 heavy, then 1×5 back-off (−10%)',
  plan(s, ctx) {
    const top = ctx.r(s.heavy);
    const raw = top * BACKOFF_FACTOR;
    const backoff = ctx.r(raw);
    return {
      groups: [
        { role: 'top', label: 'Heavy 1×5', weight: top, target: REPS, sets: 1 },
        { role: 'backoff', label: 'Back-off 1×5 (−10%)', weight: backoff, target: REPS, sets: 1, auto: 'backoff' },
      ],
      notes: [
        heavyNote(s, ctx),
        `Back-off: ${fmtKg(top)} − 10% = ${fmtKg(raw)}${clean(raw) === backoff ? ' kg' : ` → ${fmtKg(backoff)} kg`}`,
      ],
    };
  },
  apply(s, entry, ctx) {
    const g = groupOf(entry, 'top');
    if (!anyDone(g)) return;
    const w = Number(g.weight);
    const reps = setReps(g).filter((r, i) => g.sets[i].done);
    const done = reps.length > 0 && reps.every((r) => r >= REPS);
    if (done) {
      s.heavy = clean(w + ctx.inc);
      s.heavyMisses = 0;
      s.lastHeavy = { weight: w, reps, result: 'done' };
    } else {
      s.heavyMisses += 1;
      if (s.heavyMisses >= HEAVY_MISSES_BEFORE_DROP) {
        const raw = w * HEAVY_DROP_FACTOR;
        s.heavy = ctx.r(raw); // even if that's below the volume weight
        s.heavyMisses = 0;
        s.lastHeavy = { weight: w, reps, result: 'drop', raw };
      } else {
        s.heavy = w;
        s.lastHeavy = { weight: w, reps, result: 'miss' };
      }
    }
    s.src.heavy = 'log';
  },
};

const UNLOAD = {
  label: 'Unload',
  setsText: "5×4 at 80% of this cycle's 5×5 weight",
  plan(s, ctx) {
    const v = ctx.r(s.cycleVolume);
    const raw = v * UNLOAD_FACTOR;
    const w = ctx.r(raw);
    return {
      groups: [{ role: 'work', label: 'Unload 5×4', weight: w, target: UNLOAD_REPS, sets: UNLOAD_SETS }],
      notes: [`Unload: 80% of 5×5 weight ${fmtKg(v)} = ${fmtKg(raw)}${clean(raw) === w ? ' kg' : ` → ${fmtKg(w)} kg`}`],
    };
  },
  apply() {
    // The unload weight is always calculated; logging it changes nothing.
  },
};

function volumeNote(s, ctx) {
  const v = fmtKg(ctx.r(s.volume));
  const L = s.lastVolume;
  if (s.src.volume === 'adjust') return `Set by you → ${v} kg`;
  if (!L) return 'Starting weight';
  if (L.success) return `5×5 done at ${fmtKg(L.weight)} → volume ${v} next cycle`;
  return `Last volume day: ${fmtKg(L.weight)} kg ${repsText(L.reps)} → stay at ${v}, add reps`;
}

function heavyNote(s, ctx) {
  const L = s.lastHeavy;
  const h = fmtKg(ctx.r(s.heavy));
  if (s.src.heavy === 'adjust') return `Set by you → ${h} kg`;
  if (!L) return 'Starting weight';
  if (L.result === 'done') return `Top set ${fmtKg(L.weight)}×${repsText(L.reps)} done → heavy ${h} next cycle`;
  if (L.result === 'drop') return `Top set missed twice → heavy drops to ${fmtKg(L.raw)} → ${h}, build back up`;
  return `Top set ${fmtKg(L.weight)}×${repsText(L.reps)} missed → stay at ${h}`;
}

export const PAVEL_5X5 = {
  id: 'pavel-5x5',
  kind: '5x5',
  name: '5×5 block',
  about:
    'Higher volume. Six sessions repeat: 5×5 volume days, a heavy single set of 5 with a back-off set, and an unloading day at 80%. Volume and heavy weights go up when you get all your reps.',
  sessions: [
    { day: 'A', type: 'volume' },
    { day: 'B', type: 'volume' },
    { day: 'A', type: 'heavy' },
    { day: 'B', type: 'heavy' },
    { day: 'A', type: 'unload' },
    { day: 'B', type: 'unload' },
  ],
  days: { A: ['squat', 'bench'], B: ['deadlift', 'ohp'] },
  types: { volume: VOLUME, heavy: HEAVY, unload: UNLOAD },
  sessionName(index) {
    const s = this.sessions[index];
    return s ? `${s.day} — ${this.types[s.type].label}` : '?';
  },
  setsText(index) {
    return this.types[this.sessions[index].type].setsText;
  },
};

// =====================================================================================
// 3–5 block (Pavel's 3–5 method): 3×5 → triples → 1RM test, per lift
// =====================================================================================

export const PAVEL_3_5 = {
  id: 'pavel-3-5',
  kind: '3-5',
  name: '3–5 block',
  about:
    'Lower volume. A and B days alternate. Each lift starts at 3×5 around 65% of its 1RM and adds a little every session; when 3×5 gets tough it moves to triples, then to a 1RM test, then starts over. The block ends when all four lifts have been tested.',
  sessions: [{ day: 'A' }, { day: 'B' }],
  days: { A: ['squat', 'bench'], B: ['deadlift', 'ohp'] },
  types: { '3x5': { label: '3×5' }, '3x3': { label: '3×3' }, test: { label: '1RM test' } },
  sessionName(index) {
    const s = this.sessions[index];
    return s ? `${s.day} — 3–5` : '?';
  },
  setsText(index) {
    return this.sessions[index].day === 'A' ? 'Squat and bench: each at its own step' : 'Deadlift and overhead press: each at its own step';
  },
};

export const PROGRAM_BY_KIND = { '5x5': PAVEL_5X5, '3-5': PAVEL_3_5 };
export const PROGRAM_BY_ID = { [PAVEL_5X5.id]: PAVEL_5X5, [PAVEL_3_5.id]: PAVEL_3_5 };
export const BLOCK_ROTATION = ['5x5', '3-5'];

export function programFor(kind) {
  return PROGRAM_BY_KIND[kind] || PAVEL_5X5;
}

// Shortcuts for the 5×5 program, used by older parts of the app.
export const SESSIONS = PAVEL_5X5.sessions.map((s, index) => ({ ...s, index }));
export const DAY_LIFTS = PAVEL_5X5.days;
export const TYPE_LABEL = {
  volume: 'Volume',
  heavy: 'Heavy',
  unload: 'Unload',
  '3x5': '3×5',
  '3x3': '3×3',
  test: '1RM test',
};

export function sessionName(index, program = PAVEL_5X5) {
  return program.sessionName(index);
}

export function sessionSetsText(index, program = PAVEL_5X5) {
  return program.setsText(index);
}

// =====================================================================================
// settings
// =====================================================================================

export function defaultSettings() {
  return {
    schema: 3,
    lifts: {
      squat: { volume: 100, heavy: 105, increment: 5 },
      bench: { volume: 82.5, heavy: 87.5, increment: 2.5 },
      deadlift: { volume: 120, heavy: 135, increment: 5 },
      ohp: { volume: 50, heavy: 52.5, increment: 2.5 },
    },
    blocks: [{ id: 'b1', kind: '5x5', length: 24 }],
    block5x5Length: 24,
    tfStartPct: 0.65,
    tfStepPct: 0.025,
    rounding: 2.5,
    restSeconds: 300,
    theme: 'dark',
    gameMode: true, // XP, levels, belts and the Profile tab; off = plain training log
    name: '', // shown on the Profile tab
    adjustments: [], // weight edits: { at, lift, volume? | heavy?, block? }
    sequenceReset: null, // { at, index, block } — "next session is #index" set by hand
    lastExportAt: null,
  };
}

/** Fills in anything missing and upgrades settings saved by older versions. */
export function mergeSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  const lifts = {};
  for (const l of LIFTS) {
    const { light, ...rest } = (s.lifts && s.lifts[l.id]) || {}; // v1 "light" weight is no longer used
    lifts[l.id] = { ...d.lifts[l.id], ...rest };
  }
  const out = { ...d, ...s, lifts, adjustments: Array.isArray(s.adjustments) ? s.adjustments : [] };
  if (!s.schema || s.schema < 2) {
    if (s.restSeconds === 180) out.restSeconds = 300; // the old default → the 5-minute default
  }
  if (!Array.isArray(s.blocks) || !s.blocks.length) {
    out.blocks = [{ id: 'b1', kind: '5x5', length: out.block5x5Length || 24 }];
  }
  out.schema = 3;
  return out;
}

// =====================================================================================
// blocks
// =====================================================================================

export function blocksOf(settings) {
  if (settings && Array.isArray(settings.blocks) && settings.blocks.length) return settings.blocks;
  return [{ id: 'b1', kind: '5x5', length: (settings && settings.block5x5Length) || 24 }];
}

export function currentBlock(settings) {
  const b = blocksOf(settings);
  return b[b.length - 1];
}

/** Which block a workout belongs to (workouts from before blocks existed → the first block). */
export function blockIdOf(w, settings) {
  return w.block || blocksOf(settings)[0].id;
}

export function blockWorkouts(workouts, settings, blockId) {
  return sortByDate((workouts || []).filter((w) => w && w.kind === 'gym' && blockIdOf(w, settings) === blockId));
}

export function nextKind(kind) {
  const i = BLOCK_ROTATION.indexOf(kind);
  return BLOCK_ROTATION[(i + 1) % BLOCK_ROTATION.length];
}

/** "5×5 block 2", numbered per kind. */
export function blockLabel(blockId, settings) {
  const bs = blocksOf(settings);
  const b = bs.find((x) => x.id === blockId) || bs[0];
  const n = bs.filter((x) => x.kind === b.kind).indexOf(b) + 1;
  return `${programFor(b.kind).name} ${n}`;
}

/** Where you are in the current block, and whether it's finished. Never uses dates. */
export function blockStatus(workouts, settings) {
  const block = currentBlock(settings);
  const program = programFor(block.kind);
  const ws = blockWorkouts(workouts, settings, block.id);
  const count = ws.length;
  if (block.kind === '3-5') {
    const states = computeTfStates(workouts, settings, block);
    const allTested = LIFTS.every((l) => states[l.id].tested);
    const parts = LIFTS.map((l) => `${l.tag}: ${tfStepText(states[l.id])}`);
    return {
      block,
      program,
      count,
      done: !!block.endedManually || allTested,
      endedManually: !!block.endedManually,
      text: `3–5 block — ${parts.join(', ')}`,
      lifts: states,
      next: nextKind(block.kind),
    };
  }
  const length = block.length || settings.block5x5Length || 24;
  const done = !!block.endedManually || count >= length;
  return {
    block,
    program,
    count,
    length,
    done,
    endedManually: !!block.endedManually,
    text: !done
      ? `5×5 block — workout ${count + 1} of ${length}`
      : block.endedManually
        ? `5×5 block — switched after ${count} of ${length} workouts`
        : `5×5 block — all ${length} workouts done`,
    next: nextKind(block.kind),
  };
}

function tfStepText(s) {
  if (s.tested) return 'tested ✓';
  if (s.phase === '3x5') return `3×5 #${s.n5 + 1}`;
  if (s.phase === '3x3') return `triples #${s.n3 + 1}`;
  return '1RM test next';
}

/** The 1RMs at the end of the most recent 3–5 block (or the defaults the first time). */
export function lastOneRMs(workouts, settings) {
  const tf = blocksOf(settings).filter((b) => b.kind === '3-5');
  if (!tf.length) return { squat: null, bench: 105, deadlift: null, ohp: null };
  const last = tf[tf.length - 1];
  const states = computeTfStates(workouts, settings, last);
  return Object.fromEntries(LIFTS.map((l) => [l.id, states[l.id].oneRM]));
}

/** What the block start screen offers for the next block. */
export function proposeNextBlock(workouts, settings) {
  const kind = nextKind(currentBlock(settings).kind);
  if (kind === '3-5') {
    return { kind, oneRM: lastOneRMs(workouts, settings), startPct: settings.tfStartPct ?? 0.65, stepPct: settings.tfStepPct ?? 0.025 };
  }
  const cw = currentWeights(workouts, settings);
  return {
    kind,
    length: settings.block5x5Length || 24,
    weights: Object.fromEntries(LIFTS.map((l) => [l.id, { volume: cw[l.id].volume, heavy: cw[l.id].heavy }])),
  };
}

/** Starts the next block with the values from the block start screen. Returns new settings. */
export function startBlock(settings, workouts, params, now = new Date()) {
  const next = JSON.parse(JSON.stringify(settings));
  next.blocks = JSON.parse(JSON.stringify(blocksOf(settings)));
  const at = new Date(now).toISOString();
  const id = 'b' + (next.blocks.length + 1) + '-' + makeId().slice(0, 8);
  if (params.kind === '3-5') {
    const oneRM = {};
    for (const l of LIFTS) {
      const v = Number(params.oneRM && params.oneRM[l.id]);
      if (!(v > 0)) throw new Error(`Please enter a 1RM for ${l.name}.`);
      oneRM[l.id] = v;
    }
    const startPct = clampTo(params.startPct ?? 0.65, TF_START_RANGE);
    const stepPct = clampTo(params.stepPct ?? 0.025, TF_STEP_RANGE);
    next.blocks.push({ id, kind: '3-5', startedAt: at, oneRM, startPct, stepPct });
  } else {
    const length = BLOCK_LENGTHS.includes(params.length) ? params.length : next.block5x5Length || 24;
    next.blocks.push({ id, kind: '5x5', startedAt: at, length });
    // Starting weights changed on the block start screen are saved as edits from now on.
    const cw = currentWeights(workouts, settings);
    for (const l of LIFTS) {
      const want = (params.weights && params.weights[l.id]) || {};
      for (const f of ['volume', 'heavy']) {
        if (isNum(want[f]) && want[f] !== cw[l.id][f]) {
          next.adjustments = [...(next.adjustments || []), { at, lift: l.id, [f]: want[f], block: id }];
        }
      }
    }
  }
  return next;
}

function clampTo(x, [lo, hi]) {
  return Math.min(hi, Math.max(lo, Number(x)));
}

/** Ends the current block now (the block start screen for the next block appears). */
export function switchBlockNow(settings) {
  const next = JSON.parse(JSON.stringify(settings));
  next.blocks = JSON.parse(JSON.stringify(blocksOf(settings)));
  next.blocks[next.blocks.length - 1].endedManually = true;
  return next;
}

/** Can "go back to the previous block" be offered? Only while nothing is logged in the new block. */
export function canUndoSwitch(workouts, settings) {
  const bs = blocksOf(settings);
  const cur = bs[bs.length - 1];
  if (cur.endedManually) return 'reopen'; // switched, next block not started yet
  if (bs.length > 1 && blockWorkouts(workouts, settings, cur.id).length === 0) return 'remove';
  return null;
}

export function undoSwitch(workouts, settings) {
  const how = canUndoSwitch(workouts, settings);
  if (!how) return settings;
  const next = JSON.parse(JSON.stringify(settings));
  next.blocks = JSON.parse(JSON.stringify(blocksOf(settings)));
  if (how === 'remove') {
    const gone = next.blocks.pop();
    next.adjustments = (next.adjustments || []).filter((a) => a.block !== gone.id);
    if (next.sequenceReset && next.sequenceReset.block === gone.id) next.sequenceReset = null;
  }
  delete next.blocks[next.blocks.length - 1].endedManually;
  return next;
}

// =====================================================================================
// the sequence
// =====================================================================================

/** Index of the next session in the current block: the one after the last gym session
 *  logged in this block (by date), unless you set the position by hand in Settings and
 *  haven't logged a gym workout since. Never tied to weekdays. */
export function nextSessionIndex(workouts, settings) {
  const block = currentBlock(settings);
  const n = programFor(block.kind).sessions.length;
  const ws = blockWorkouts(workouts, settings, block.id);
  const reset = settings && settings.sequenceReset;
  const resetHere = reset && isNum(reset.index) && (reset.block ? reset.block === block.id : block.id === blocksOf(settings)[0].id);
  if (resetHere) {
    const resetAt = ts(reset.at);
    const loggedSince = ws.some((w) => (isNum(w.createdAt) ? w.createdAt : ts(w.date)) > resetAt);
    if (!loggedSince) return reset.index % n;
  }
  const last = ws[ws.length - 1];
  if (!last) return 0;
  return (last.sessionIndex + 1) % n;
}

// =====================================================================================
// rest days
// =====================================================================================

const DAY_MS = 86400000;

export function localDay(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

export function addDays(d, n) {
  const x = localDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function daysBetween(a, b) {
  return Math.round((localDay(b) - localDay(a)) / DAY_MS);
}

/** Where you are today: rest day or training day, when the next session is due,
 *  the next few sessions with their earliest dates, and any notes to show. */
export function schedule(workouts, settings, now = new Date(), count = 3) {
  const st = blockStatus(workouts, settings);
  const program = st.done ? programFor(st.next) : st.program;
  const next = st.done ? 0 : nextSessionIndex(workouts, settings);
  const gym = sortByDate((workouts || []).filter((w) => w && w.kind === 'gym'));
  const last = gym[gym.length - 1] || null;
  const today = localDay(now);
  const due = last ? addDays(last.date, REST_DAYS + 1) : today;
  const daysSinceLast = last ? daysBetween(last.date, now) : null;
  const isRestDay = !!last && today < due;
  const first = due > today ? due : today;
  const upcoming = Array.from({ length: count }, (_, i) => {
    const idx = (next + i) % program.sessions.length;
    return { sessionIndex: idx, name: program.sessionName(idx), date: addDays(first, i * (REST_DAYS + 1)) };
  });
  let warning = null;
  if (isRestDay) {
    warning =
      daysSinceLast <= 0
        ? 'You already trained today — rest day recommended'
        : 'You trained yesterday — rest day recommended';
  }
  const longBreak = daysSinceLast != null && daysSinceLast >= LONG_BREAK_DAYS;
  return {
    next,
    nextName: program.sessionName(next),
    blockDone: st.done,
    lastDate: last ? last.date : null,
    due,
    today,
    isRestDay,
    daysSinceLast,
    warning,
    longBreak,
    longBreakNote: longBreak ? `${daysSinceLast} days since last session — adjust weights if needed` : null,
    upcoming,
  };
}

// =====================================================================================
// 5×5 progression state (continues across all 5×5 blocks)
// =====================================================================================

function freshState(base) {
  return {
    volume: base.volume,
    heavy: base.heavy,
    cycleVolume: base.volume, // 5×5 weight lifted this cycle (unload = 80% of it)
    heavyMisses: 0, // heavy days in a row with a missed top set
    src: { volume: 'start', heavy: 'start' },
    lastVolume: null,
    lastHeavy: null,
  };
}

function context(settings, liftId) {
  const step = settings.rounding;
  return { inc: settings.lifts[liftId].increment, step, r: (x) => roundTo(x, step) };
}

/** Replays history and returns, per lift, the 5×5 state the next sessions are planned from. */
export function computeStates(workouts, settings) {
  const states = {};
  for (const l of LIFTS) states[l.id] = freshState(settings.lifts[l.id]);

  // Order: by block first (so a block's starting weights always come before its workouts,
  // even if a workout is back-dated), then by date.
  const blocks = blocksOf(settings);
  const blockIndex = Object.fromEntries(blocks.map((b, i) => [b.id, i]));
  const blockAt = (t) => {
    let i = 0;
    blocks.forEach((b, j) => {
      if (b.startedAt && ts(b.startedAt) <= t) i = j;
    });
    return i;
  };
  const events = [];
  for (const w of workouts || []) {
    if (w && w.kind === 'gym') events.push({ b: blockIndex[blockIdOf(w, settings)] ?? 0, k: 1, t: ts(w.date), o: w.createdAt || 0, w });
  }
  for (const a of settings.adjustments || []) {
    const b = a.block && a.block in blockIndex ? blockIndex[a.block] : blockAt(ts(a.at));
    events.push({ b, k: a.block ? 0 : 1, t: ts(a.at), o: 0, a });
  }
  events.sort((x, y) => x.b - y.b || x.k - y.k || x.t - y.t || x.o - y.o);

  for (const e of events) {
    if (e.a) {
      applyAdjustment(states[e.a.lift], e.a);
      continue;
    }
    for (const entry of e.w.lifts || []) {
      const s = states[entry.lift];
      const type = PAVEL_5X5.types[normType(entry.type)];
      if (!s || !type) continue; // 3–5 block entries don't touch the 5×5 weights
      type.apply(s, entry, context(settings, entry.lift));
    }
  }
  return states;
}

function applyAdjustment(s, a) {
  if (!s) return;
  if (isNum(a.volume)) {
    s.volume = a.volume;
    s.src.volume = 'adjust';
  }
  if (isNum(a.heavy)) {
    s.heavy = a.heavy;
    s.src.heavy = 'adjust';
  }
}

/** 5×5 plan for one lift on a session of the given type. */
export function planLift(liftId, type, s, settings) {
  const t = normType(type);
  const p = PAVEL_5X5.types[t].plan(s, context(settings, liftId));
  return { lift: liftId, type: t, groups: p.groups, notes: p.notes, note: p.notes.join(' · ') };
}

// =====================================================================================
// 3–5 progression state (per 3–5 block)
// =====================================================================================

/** Replays the workouts of one 3–5 block and returns each lift's step and next weight. */
export function computeTfStates(workouts, settings, block) {
  const startPct = block.startPct ?? settings.tfStartPct ?? 0.65;
  const stepPct = block.stepPct ?? settings.tfStepPct ?? 0.025;
  const states = {};
  for (const l of LIFTS) {
    const rm = Number((block.oneRM || {})[l.id]) || 0;
    states[l.id] = {
      oneRM: rm,
      phase: '3x5',
      next: rm * startPct,
      n5: 0, // 3×5 sessions done since the last (re)start
      n3: 0, // full 3×3 sessions done
      tested: false,
      last: null,
      startPct,
      stepPct,
    };
  }
  for (const w of blockWorkouts(workouts, settings, block.id)) {
    for (const entry of w.lifts || []) {
      const s = states[entry.lift];
      if (s) applyTf(s, entry);
    }
  }
  return states;
}

function applyTf(s, entry) {
  const step = s.stepPct * s.oneRM;
  if (entry.type === '3x5') {
    const g = groupOf(entry, 'work');
    if (!anyDone(g)) return; // lift skipped that day
    const w = Number(g.weight);
    const reps = setReps(g);
    const missed = reps.length < 3 || reps.some((r) => r < 5);
    const tough = entry.tough === true;
    s.n5 += 1;
    s.next = w + step;
    s.last = { type: '3x5', weight: w, reps, missed, tough };
    if (missed || tough) {
      s.phase = '3x3';
      s.n3 = 0;
    }
  } else if (entry.type === '3x3') {
    const g = groupOf(entry, 'work');
    if (!anyDone(g)) return;
    const w = Number(g.weight);
    const reps = setReps(g);
    const full = reps.length >= 3 && reps.every((r) => r >= 3);
    if (full) {
      s.n3 += 1;
      s.next = w + step;
      if (s.n3 >= TF_TRIPLE_SESSIONS) s.phase = 'test';
    } else {
      s.next = w; // missed a triple → repeat the weight
    }
    s.last = { type: '3x3', weight: w, reps, full, n3: s.n3 };
  } else if (entry.type === 'test') {
    const best = bestCleanSingle(entry.attempts);
    const prev = s.oneRM;
    s.oneRM = best != null ? best : prev; // no clean single → keep the old 1RM
    s.tested = true;
    s.phase = '3x5';
    s.n5 = 0;
    s.n3 = 0;
    s.next = s.oneRM * s.startPct;
    s.last = { type: 'test', best, prev };
  }
}

function tfPlanLift(liftId, s, settings) {
  const r = (x) => roundTo(x, settings.rounding);
  const pct = fmtPct(s.stepPct);
  if (s.phase === 'test') {
    return {
      lift: liftId,
      type: 'test',
      groups: [],
      oneRM: s.oneRM,
      notes: [`1RM test: work up to a conservative 1RM — perfect technique only. Current 1RM ${fmtKg(s.oneRM)} kg.`],
    };
  }
  const w = r(s.next);
  const calc = (x) => (clean(x) === w ? `${fmtKg(x)} kg` : `${fmtKg(x)} → ${fmtKg(w)} kg`);
  const L = s.last;
  let note;
  if (!L) note = `3×5 at ${fmtPct(s.startPct)}% of 1RM ${fmtKg(s.oneRM)} = ${calc(s.next)}`;
  else if (L.type === 'test')
    note =
      (L.best != null ? `New 1RM ${fmtKg(s.oneRM)}` : `No clean single — 1RM stays ${fmtKg(s.oneRM)}`) +
      ` → 3×5 at ${fmtPct(s.startPct)}% = ${calc(s.next)}`;
  else if (L.type === '3x5') {
    const head = `Last 3×5: ${fmtKg(L.weight)} kg ${repsText(L.reps)}`;
    const why = L.missed ? 'missed reps' : L.tough ? 'tough' : '';
    note = why ? `${head} — ${why} → triples, +${pct}% of 1RM = ${calc(s.next)}` : `${head} → +${pct}% of 1RM = ${calc(s.next)}`;
  } else if (L.full) note = `Triples ${L.n3} of ${TF_TRIPLE_SESSIONS} done → +${pct}% of 1RM = ${calc(s.next)}`;
  else note = `Last 3×3: ${fmtKg(L.weight)} kg ${repsText(L.reps)} — missed a triple → repeat ${fmtKg(w)} kg`;
  const is5 = s.phase === '3x5';
  return {
    lift: liftId,
    type: s.phase,
    groups: [{ role: 'work', label: is5 ? '3×5' : '3×3', weight: w, target: is5 ? 5 : 3, sets: 3 }],
    notes: [note],
  };
}

// =====================================================================================
// planning a session (any block)
// =====================================================================================

export function planSession(index, workouts, settings) {
  const block = currentBlock(settings);
  const program = programFor(block.kind);
  const sess = program.sessions[index];
  let lifts;
  if (block.kind === '3-5') {
    const states = computeTfStates(workouts, settings, block);
    lifts = program.days[sess.day].map((id) => tfPlanLift(id, states[id], settings));
  } else {
    const states = computeStates(workouts, settings);
    lifts = program.days[sess.day].map((id) => planLift(id, sess.type, states[id], settings));
  }
  for (const l of lifts) l.note = l.notes.join(' · ');
  return {
    program: program.id,
    block: block.id,
    sessionIndex: index,
    day: sess.day,
    type: sess.type || null,
    name: program.sessionName(index),
    lifts,
  };
}

/** A blank, ready-to-log workout built from a plan (all sets pre-filled, not done). */
export function workoutFromPlan(plan) {
  return {
    id: makeId(),
    kind: 'gym',
    program: plan.program || PAVEL_5X5.id,
    block: plan.block,
    sessionIndex: plan.sessionIndex,
    date: null,
    createdAt: null,
    lifts: plan.lifts.map((l) => ({
      lift: l.lift,
      type: l.type,
      ...(l.type === 'test' ? { attempts: [], oneRM: l.oneRM } : {}),
      groups: l.groups.map((g) => ({
        role: g.role,
        label: g.label,
        weight: g.weight,
        target: g.target,
        ...(g.auto ? { auto: g.auto } : {}),
        sets: Array.from({ length: g.sets }, () => ({ reps: g.target, done: false })),
      })),
    })),
    pullups: null, // { sets: [{reps, done}] } when added
    cardio: null, // { type: 'run'|'row'|'other', minutes, distance, unit: 'km'|'m' }
    extras: [], // [{ name, weight, sets: [{reps}] }]
    notes: '',
  };
}

/** Title for any logged gym workout, e.g. "A — Heavy" or "B — 3–5". */
export function workoutTitle(w) {
  const program = PROGRAM_BY_ID[w.program] || PAVEL_5X5;
  return program.sessionName(w.sessionIndex);
}

/** Back-off weight for a given top-set weight (used when you change the top set on the day). */
export function backoffFor(topWeight, settings) {
  return roundTo(topWeight * BACKOFF_FACTOR, settings.rounding);
}

// =====================================================================================
// settings edits
// =====================================================================================

/** Current 5×5 working weights (what the next session of each type would use). */
export function currentWeights(workouts, settings) {
  const states = computeStates(workouts, settings);
  const out = {};
  for (const l of LIFTS) {
    const s = states[l.id];
    const vol = planLift(l.id, 'volume', s, settings).groups[0];
    const hv = planLift(l.id, 'heavy', s, settings).groups;
    const un = planLift(l.id, 'unload', s, settings).groups[0];
    out[l.id] = {
      volume: vol.weight,
      heavy: hv[0].weight,
      backoff: hv[1].weight,
      unload: un.weight,
      increment: settings.lifts[l.id].increment,
      heavyMisses: s.heavyMisses,
    };
  }
  return out;
}

/** Changing a 5×5 working weight in Settings. Before any workout is logged for that
 *  lift it just changes the starting weight; afterwards it is recorded as a dated
 *  edit so it takes effect from now on without rewriting history. */
export function editWeight(settings, workouts, liftId, field, value, now = new Date()) {
  const next = JSON.parse(JSON.stringify(settings));
  if (field === 'increment') {
    next.lifts[liftId].increment = value;
    return next;
  }
  const hasHistory = (workouts || []).some(
    (w) => w && w.kind === 'gym' && (w.lifts || []).some((e) => e.lift === liftId && PAVEL_5X5.types[normType(e.type)])
  );
  if (!hasHistory) {
    next.lifts[liftId][field] = value;
    next.adjustments = (next.adjustments || []).filter((a) => !(a.lift === liftId && isNum(a[field])));
  } else {
    next.adjustments = [...(next.adjustments || []), { at: new Date(now).toISOString(), lift: liftId, [field]: value }];
  }
  return next;
}

// =====================================================================================
// backup
// =====================================================================================

export function makeBackup(settings, workouts) {
  return { app: 'strength-log', version: 5, exportedAt: new Date().toISOString(), settings, workouts };
}

export function readBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'strength-log' || !Array.isArray(obj.workouts)) {
    throw new Error("This file isn't a Strength Log backup.");
  }
  return {
    settings: mergeSettings(obj.settings),
    workouts: obj.workouts.filter((w) => w && (w.kind === 'gym' || w.kind === 'home' || w.kind === 'bw') && w.id),
  };
}

// =====================================================================================
// progress
// =====================================================================================

/** Per gym workout that included the lift: date, top weight and the done sets. */
export function liftHistory(workouts, liftId) {
  const out = [];
  for (const w of sortByDate((workouts || []).filter((x) => x.kind === 'gym'))) {
    const e = (w.lifts || []).find((x) => x.lift === liftId);
    if (!e) continue;
    const sets = [];
    for (const g of e.groups || [])
      for (const x of g.sets || []) if (x.done && x.reps > 0) sets.push({ weight: Number(g.weight), reps: x.reps });
    for (const a of e.attempts || [])
      if (a.clean !== false && a.reps > 0 && a.weight > 0) sets.push({ weight: Number(a.weight), reps: a.reps | 0 });
    if (!sets.length) continue;
    out.push({
      id: w.id,
      date: w.date,
      top: Math.max(...sets.map((x) => x.weight)),
      sets,
      type: normType(e.type),
      deload: !!e.deload,
    });
  }
  return out;
}

/** Heaviest sets for a lift (unique weight × reps, earliest date kept). */
export function bestSets(workouts, liftId, n = 6) {
  const all = [];
  for (const h of liftHistory(workouts, liftId)) for (const x of h.sets) all.push({ ...x, date: h.date });
  all.sort((a, b) => b.weight - a.weight || b.reps - a.reps || ts(a.date) - ts(b.date));
  const seen = new Set();
  const out = [];
  for (const x of all) {
    const k = x.weight + 'x' + x.reps;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

/** 1RMs over time for a lift: entered at a 3–5 block start, and tested in 1RM test sessions. */
export function oneRMHistory(workouts, settings, liftId) {
  const out = [];
  for (const b of blocksOf(settings).filter((x) => x.kind === '3-5')) {
    if (b.oneRM && b.oneRM[liftId]) out.push({ date: b.startedAt, weight: Number(b.oneRM[liftId]), source: 'entered' });
    for (const w of blockWorkouts(workouts, settings, b.id)) {
      const e = (w.lifts || []).find((x) => x.lift === liftId && x.type === 'test');
      if (!e) continue;
      const best = bestCleanSingle(e.attempts);
      if (best != null) out.push({ date: w.date, weight: best, source: 'tested' });
    }
  }
  return out;
}
