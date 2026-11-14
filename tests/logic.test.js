// Run with:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings,
  mergeSettings,
  planSession,
  workoutFromPlan,
  nextSessionIndex,
  currentWeights,
  computeStates,
  editWeight,
  roundTo,
  schedule,
  makeBackup,
  readBackup,
  bestSets,
  liftHistory,
  sessionName,
  blockStatus,
  proposeNextBlock,
  startBlock,
  switchBlockNow,
  canUndoSwitch,
  undoSwitch,
  currentBlock,
  oneRMHistory,
  workoutTitle,
  blockLabel,
} from '../js/logic.js';

// ---- helpers ----------------------------------------------------------------

/** A date in local time (the phone's time zone), as the app stores it. */
const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
const day = (iso) => {
  const x = new Date(iso);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
};

let clock = new Date(2026, 0, 5, 18).getTime();
function nextDay(days = 2) {
  clock += days * 86400000;
  return new Date(clock).toISOString();
}

/** Log a session exactly as recommended, with optional changes.
 *  reps:   { liftId: [reps per set of the first group] }
 *  weight: { liftId: weight of the first group (volume / heavy top set / unload) } */
function log(workouts, settings, index, { reps = {}, weight = {}, date, tweak } = {}) {
  const w = workoutFromPlan(planSession(index, workouts, settings));
  for (const e of w.lifts) {
    e.groups.forEach((g, gi) => {
      if (gi === 0 && weight[e.lift] != null) g.weight = weight[e.lift];
      g.sets.forEach((s, si) => {
        s.done = true;
        if (gi === 0 && reps[e.lift]) s.reps = reps[e.lift][si];
      });
    });
  }
  w.date = date || nextDay();
  w.createdAt = Date.parse(w.date);
  if (tweak) tweak(w);
  workouts.push(w);
  return w;
}

/** One full cycle (#1–#6). volume / heavy: options for the volume and heavy days. */
function logCycle(workouts, settings, { volume = {}, heavy = {} } = {}) {
  for (let i = 0; i < 6; i++) log(workouts, settings, i, i < 2 ? volume : i < 4 ? heavy : {});
}

function plan(workouts, settings, index) {
  const p = planSession(index, workouts, settings);
  return Object.fromEntries(p.lifts.map((l) => [l.lift, l]));
}

const MISS = [5, 5, 5, 5, 4];

// ---- 1. full 5×5 → volume up, unload follows -----------------------------------

test('1. full 5×5 on volume day → volume + increment next cycle; unload follows the 5×5 weight lifted', () => {
  const s = defaultSettings();
  const W = [];
  assert.equal(plan(W, s, 0).squat.groups[0].weight, 100);
  assert.equal(plan(W, s, 4).squat.groups[0].weight, 80);

  logCycle(W, s);

  let p = plan(W, s, 0);
  assert.equal(p.squat.groups[0].weight, 105);
  assert.equal(p.bench.groups[0].weight, 85);
  assert.equal(p.squat.notes[0], '5×5 done at 100 → volume 105 next cycle');
  assert.equal(plan(W, s, 1).deadlift.groups[0].weight, 125);
  assert.equal(plan(W, s, 1).ohp.groups[0].weight, 52.5);

  // Cycle 2's volume day at 105 → cycle 2's unload is 80% of 105.
  log(W, s, 0);
  p = plan(W, s, 4); // unload day
  assert.equal(p.squat.groups[0].weight, 85); // 80% of 105 = 84 → 85
  assert.equal(p.squat.groups[0].sets, 5);
  assert.equal(p.squat.groups[0].target, 4);
  assert.equal(p.squat.notes[0], 'Unload: 80% of 5×5 weight 105 = 84 → 85 kg');
  assert.equal(p.bench.groups[0].weight, 67.5); // 80% of 85 = 68 → 67.5

  // Pre-filled with 4 reps per set.
  const w = workoutFromPlan(planSession(4, [], s));
  assert.deepEqual(
    w.lifts[0].groups[0].sets.map((x) => x.reps),
    [4, 4, 4, 4, 4]
  );
});

// ---- 2. missed reps → stay, no deload --------------------------------------------

test('2. missed reps on volume day → volume stays the same; never an automatic deload', () => {
  const s = defaultSettings();
  const W = [];
  logCycle(W, s, { volume: { reps: { squat: MISS } } });
  let p = plan(W, s, 0);
  assert.equal(p.squat.groups[0].weight, 100);
  assert.equal(p.squat.notes[0], 'Last volume day: 100 kg 5,5,5,5,4 → stay at 100, add reps');
  assert.equal(p.bench.groups[0].weight, 85); // bench did get 5×5

  // Three, four cycles missed: still 5×5 at the same weight.
  logCycle(W, s, { volume: { reps: { squat: [5, 5, 4, 4, 3] } } });
  logCycle(W, s, { volume: { reps: { squat: [5, 5, 5, 4, 4] } } });
  p = plan(W, s, 0);
  assert.equal(p.squat.groups[0].weight, 100);
  assert.equal(p.squat.groups[0].sets, 5);
  assert.equal(p.squat.groups[0].target, 5);
  assert.equal(p.squat.groups[0].label, '5×5');

  // A set not ticked as done counts as missed.
  const W2 = [];
  log(W2, s, 0, { tweak: (w) => (w.lifts[0].groups[0].sets[4].done = false) });
  assert.equal(plan(W2, s, 0).squat.groups[0].weight, 100);
});

// ---- 3. heavy progression ------------------------------------------------------------

test('3. heavy top set: done → +increment; missed → same; missed twice in a row → −10%', () => {
  const s = defaultSettings();
  const W = [];
  log(W, s, 0);
  log(W, s, 1);
  log(W, s, 2); // squat 105×5 done
  let p = plan(W, s, 2);
  assert.equal(p.squat.groups[0].weight, 110);
  assert.equal(p.squat.notes[0], 'Top set 105×5 done → heavy 110 next cycle');

  // Deadlift (volume 120, heavy 135): miss, miss → 135 × 0.9 = 121.5 → 122.5, then build up.
  const D = [];
  log(D, s, 3, { reps: { deadlift: [4] } });
  p = plan(D, s, 3);
  assert.equal(p.deadlift.groups[0].weight, 135); // missed once → same
  assert.equal(p.deadlift.notes[0], 'Top set 135×4 missed → stay at 135');
  log(D, s, 3, { reps: { deadlift: [3] } });
  p = plan(D, s, 3);
  assert.equal(p.deadlift.groups[0].weight, 122.5);
  assert.equal(p.deadlift.notes[0], 'Top set missed twice → heavy drops to 121.5 → 122.5, build back up');
  log(D, s, 3); // 122.5×5 done
  assert.equal(plan(D, s, 3).deadlift.groups[0].weight, 127.5);

  // Miss, done, miss is NOT two in a row → no drop.
  const M = [];
  log(M, s, 3, { reps: { ohp: [4] } });
  log(M, s, 3);
  log(M, s, 3, { reps: { ohp: [4] } });
  assert.equal(plan(M, s, 3).ohp.groups[0].weight, 55); // 52.5 → 55 after the success, kept after one miss
});

// ---- 4. back-off and unload rounding -------------------------------------------------

test('4. back-off = heavy −10%, unload = 80% of volume, nearest 2.5 kg with ties rounded down', () => {
  assert.equal(roundTo(78.75, 2.5), 77.5); // tie → down
  assert.equal(roundTo(94.5, 2.5), 95);
  assert.equal(roundTo(66, 2.5), 65);
  assert.equal(roundTo(84, 2.5), 85);
  assert.equal(roundTo(83.75, 2.5), 82.5); // tie → down
  assert.equal(roundTo(65.625, 1.25), 65); // tie → down with small plates

  const s = defaultSettings();
  const cw = currentWeights([], s);
  // The table from the v2 spec:
  assert.deepEqual(
    Object.fromEntries(Object.entries(cw).map(([k, v]) => [k, [v.volume, v.heavy, v.backoff, v.unload, v.increment]])),
    {
      squat: [100, 105, 95, 80, 5],
      bench: [82.5, 87.5, 77.5, 65, 2.5],
      deadlift: [120, 135, 122.5, 95, 5],
      ohp: [50, 52.5, 47.5, 40, 2.5],
    }
  );
  const p = plan([], s, 2);
  assert.equal(p.bench.groups[1].weight, 77.5);
  assert.equal(p.bench.notes[1], 'Back-off: 87.5 − 10% = 78.75 → 77.5 kg');
  assert.equal(plan([], s, 4).squat.notes[0], 'Unload: 80% of 5×5 weight 100 = 80 kg');

  // Rounding step is editable.
  const s2 = { ...defaultSettings(), rounding: 1.25 };
  assert.equal(plan([], s2, 2).bench.groups[1].weight, 78.75);
  assert.equal(plan([], s2, 4).bench.groups[0].weight, 66.25); // 66 → nearest 1.25
});

// ---- 5. heavy never below volume ------------------------------------------------------

test('v3-1. heavy missed twice → drops 10% even below the volume weight, then +increment per cycle', () => {
  const s = defaultSettings();
  const W = [];
  log(W, s, 2, { reps: { squat: [4] } }); // 105 missed
  log(W, s, 2, { reps: { squat: [4] } }); // 105 missed again
  let p = plan(W, s, 2);
  assert.equal(p.squat.groups[0].weight, 95); // 94.5 → 95, below volume 100 — allowed
  assert.equal(p.squat.groups[1].weight, 85); // back-off: 95 − 10% = 85.5 → 85
  assert.equal(p.squat.notes[0], 'Top set missed twice → heavy drops to 94.5 → 95, build back up');
  assert.equal(currentWeights(W, s).squat.volume, 100); // volume untouched
  log(W, s, 2);
  assert.equal(plan(W, s, 2).squat.groups[0].weight, 100);
  log(W, s, 2);
  assert.equal(plan(W, s, 2).squat.groups[0].weight, 105);
  log(W, s, 2);
  p = plan(W, s, 2);
  assert.equal(p.squat.groups[0].weight, 110);

  // Volume raised above heavy in Settings: heavy is left alone.
  const s2 = editWeight(defaultSettings(), [], 'squat', 'volume', 110);
  assert.equal(plan([], s2, 2).squat.groups[0].weight, 105);
});

test('v3-2. unload = 80% of the 5×5 weight actually lifted this cycle; the raise shows on the next volume day', () => {
  const s = defaultSettings();
  const W = [];
  log(W, s, 0); // 5×5 done at 100
  log(W, s, 1);
  assert.equal(plan(W, s, 4).squat.groups[0].weight, 80); // 80% of 100, not of 105
  assert.equal(plan(W, s, 4).squat.notes[0], 'Unload: 80% of 5×5 weight 100 = 80 kg');
  assert.equal(plan(W, s, 0).squat.groups[0].weight, 105); // next volume day
  log(W, s, 2);
  log(W, s, 3);
  log(W, s, 4);
  assert.equal(W[4].lifts[0].groups[0].weight, 80);
  log(W, s, 5);
  log(W, s, 0); // next cycle: 5×5 at 105
  assert.equal(plan(W, s, 4).squat.groups[0].weight, 85); // 84 → 85

  // Overridden 5×5 weight: unload follows what was lifted.
  const W2 = [];
  log(W2, s, 0, { weight: { squat: 102.5 }, reps: { squat: MISS } });
  assert.equal(plan(W2, s, 4).squat.groups[0].weight, 82.5); // 82 → 82.5
});

// ---- 6. overrides win -------------------------------------------------------------------

test('6. manual weight override → next recommendation uses the logged weight', () => {
  const s = defaultSettings();
  let W = [];
  log(W, s, 0, { weight: { squat: 102.5 } });
  assert.equal(plan(W, s, 0).squat.groups[0].weight, 107.5);

  W = [];
  log(W, s, 0, { weight: { squat: 95 }, reps: { squat: MISS } });
  assert.equal(plan(W, s, 0).squat.groups[0].weight, 95);
  assert.equal(plan(W, s, 4).squat.groups[0].weight, 75); // unload follows: 80% of 95 = 76 → 75

  W = [];
  log(W, s, 2, { weight: { squat: 110 } }); // heavier top set than planned, done
  assert.equal(plan(W, s, 2).squat.groups[0].weight, 115);
  assert.equal(plan(W, s, 2).squat.groups[1].weight, 102.5); // 115 − 10% = 103.5 → 102.5

  // An unload override doesn't change anything (unload is always 80% of volume).
  W = [];
  log(W, s, 4, { weight: { squat: 90 } });
  assert.equal(plan(W, s, 4).squat.groups[0].weight, 80);

  // Changing a weight in Settings after history exists applies from now on.
  W = [];
  logCycle(W, s);
  const s2 = editWeight(s, W, 'squat', 'heavy', 120, '2030-01-01T00:00:00Z');
  assert.equal(plan(W, s2, 2).squat.groups[0].weight, 120);
  assert.match(plan(W, s2, 2).squat.notes[0], /Set by you → 120 kg/);
});

// ---- 7. gaps of any length ---------------------------------------------------------------

test('7. gaps: the next session in the sequence is never skipped; long break note after 14+ days', () => {
  const s = defaultSettings();
  const W = [];
  log(W, s, 0, { date: at(2026, 11, 16) }); // Monday
  let sc = schedule(W, s, new Date(2026, 10, 20, 9)); // Friday
  assert.equal(sc.next, 1);
  assert.equal(sessionName(sc.next), 'B — Volume');
  assert.equal(sc.isRestDay, false);
  assert.equal(sc.longBreak, false);

  log(W, s, 1, { date: at(2026, 11, 20) }); // Friday
  const before = plan(W, s, 2);
  sc = schedule(W, s, new Date(2026, 11, 11, 9)); // 3 weeks later
  assert.equal(sc.next, 2); // #3, not skipped
  assert.equal(sc.daysSinceLast, 21);
  assert.equal(sc.longBreak, true);
  assert.equal(sc.longBreakNote, '21 days since last session — adjust weights if needed');
  assert.deepEqual(plan(W, s, 2), before); // weights unchanged by the gap

  assert.equal(schedule(W, s, new Date(2026, 11, 3, 9)).longBreak, false); // 13 days
  assert.equal(schedule(W, s, new Date(2026, 11, 4, 9)).longBreak, true); // 14 days

  // Home kettlebell sessions don't move the gym sequence or the rest days.
  W.push({ id: 'kb', kind: 'home', date: at(2026, 12, 10), swings: { reps: 100, kg: 20 } });
  assert.equal(schedule(W, s, new Date(2026, 11, 11, 9)).next, 2);

  // Wrap-around and a back-dated entry.
  const X = [];
  for (let i = 0; i < 6; i++) log(X, s, i);
  assert.equal(nextSessionIndex(X, s), 0);
  log(X, s, 2, { date: '2025-01-01T12:00:00Z' }); // old workout entered late
  assert.equal(nextSessionIndex(X, s), 0);

  // Setting the position by hand in Settings.
  s.sequenceReset = { at: new Date(clock + 86400000).toISOString(), index: 3 };
  assert.equal(nextSessionIndex(X, s), 3);
});

// ---- 8. rest days -------------------------------------------------------------------------

test('8. rest days: logged Tuesday → Wednesday is a rest day, due Thursday; training anyway shifts it', () => {
  const s = defaultSettings();
  const W = [];
  log(W, s, 0, { date: at(2026, 11, 17) }); // Tuesday
  let sc = schedule(W, s, new Date(2026, 10, 18, 8)); // Wednesday
  assert.equal(sc.isRestDay, true);
  assert.equal(day(sc.due), '2026-11-19'); // Thursday
  assert.equal(sc.warning, 'You trained yesterday — rest day recommended');
  assert.deepEqual(
    sc.upcoming.map((u) => [u.sessionIndex, day(u.date)]),
    [
      [1, '2026-11-19'],
      [2, '2026-11-21'],
      [3, '2026-11-23'],
    ]
  );
  // Thursday: training day.
  assert.equal(schedule(W, s, new Date(2026, 10, 19, 8)).isRestDay, false);
  // Same day as training: still a rest day (already trained today).
  assert.equal(schedule(W, s, new Date(2026, 10, 17, 21)).warning, 'You already trained today — rest day recommended');

  // Train anyway on Wednesday: it logs normally and the next session is due Friday.
  log(W, s, sc.next, { date: at(2026, 11, 18) });
  assert.equal(W.length, 2);
  sc = schedule(W, s, new Date(2026, 10, 19, 8)); // Thursday
  assert.equal(sc.isRestDay, true);
  assert.equal(day(sc.due), '2026-11-20');
  assert.equal(sc.next, 2);

  // Overdue (no training for days): it's a training day, the session is due today.
  sc = schedule(W, s, new Date(2026, 10, 25, 8));
  assert.equal(sc.isRestDay, false);
  assert.equal(day(sc.upcoming[0].date), '2026-11-25');

  // Nothing logged yet: today is a training day.
  assert.equal(schedule([], s, new Date(2026, 10, 18)).isRestDay, false);
});

// ---- 9. old data ---------------------------------------------------------------------------

test('9. v1 data: Light sessions map to Unload, nothing is lost, old settings upgrade', () => {
  const v1Settings = {
    lifts: {
      squat: { volume: 100, heavy: 105, light: 90, increment: 5 },
      bench: { volume: 82.5, heavy: 87.5, light: 80, increment: 2.5 },
      deadlift: { volume: 120, heavy: 135, light: 120, increment: 5 },
      ohp: { volume: 50, heavy: 52.5, light: 45, increment: 2.5 },
    },
    rounding: 2.5,
    restSeconds: 180,
    theme: 'dark',
    adjustments: [{ at: '2026-01-01T00:00:00Z', lift: 'squat', light: 95 }],
    lastExportAt: '2026-11-01T00:00:00Z',
  };
  const s = mergeSettings(v1Settings);
  assert.equal(s.restSeconds, 300);
  assert.equal(s.lifts.squat.light, undefined);
  assert.equal(s.lastExportAt, '2026-11-01T00:00:00Z');
  assert.equal(mergeSettings({ ...s, restSeconds: 180 }).restSeconds, 180); // a v2 user's own choice stays

  const set = (reps, done = true) => ({ reps, done });
  const v1Light = {
    id: 'old-light',
    kind: 'gym',
    sessionIndex: 4,
    date: at(2026, 11, 2),
    createdAt: Date.parse(at(2026, 11, 2)),
    lifts: [
      { lift: 'squat', type: 'light', deload: false, groups: [{ role: 'work', label: '2×5', weight: 90, target: 5, sets: [set(5), set(5)] }] },
      { lift: 'bench', type: 'light', deload: false, groups: [{ role: 'work', label: '2×5', weight: 80, target: 5, sets: [set(5), set(4)] }] },
    ],
  };
  const v1Deload = {
    id: 'old-deload',
    kind: 'gym',
    sessionIndex: 0,
    date: at(2026, 10, 26),
    createdAt: Date.parse(at(2026, 10, 26)),
    lifts: [
      { lift: 'squat', type: 'volume', deload: true, groups: [{ role: 'work', label: 'Deload 5×4', weight: 80, target: 4, sets: [4, 4, 4, 4, 4].map((r) => set(r)) }] },
    ],
  };
  const snapshot = JSON.stringify([v1Deload, v1Light]);
  const W = [v1Deload, v1Light];

  assert.equal(nextSessionIndex(W, s), 5); // after #5 (A Light → A Unload) comes #6
  assert.equal(sessionName(4), 'A — Unload');
  const h = liftHistory(W, 'squat');
  assert.deepEqual(
    h.map((x) => [x.type, x.sets.length]),
    [
      ['volume', 5],
      ['unload', 2],
    ]
  );
  // Logged sets aren't touched, and old deload/light days don't change the volume weight.
  assert.equal(computeStates(W, s).squat.volume, 100);
  assert.equal(plan(W, s, 5).deadlift.groups[0].weight, 95);
  assert.equal(JSON.stringify(W), snapshot);
});

// ---- extras -----------------------------------------------------------------------------------

test('a lift skipped entirely that day is ignored, and deleting a workout recalculates', () => {
  const s = defaultSettings();
  const W = [];
  log(W, s, 0, { tweak: (w) => w.lifts[1].groups[0].sets.forEach((x) => (x.done = false)) });
  assert.equal(plan(W, s, 0).squat.groups[0].weight, 105);
  assert.equal(plan(W, s, 0).bench.groups[0].weight, 82.5);
  assert.equal(plan(W, s, 0).bench.notes[0], 'Starting weight');
  W.pop();
  assert.equal(plan(W, s, 0).squat.groups[0].weight, 100);
});

test('editing a starting weight before any history just changes the start', () => {
  let s = defaultSettings();
  s = editWeight(s, [], 'ohp', 'volume', 47.5);
  assert.equal(s.lifts.ohp.volume, 47.5);
  assert.equal(s.adjustments.length, 0);
  s = editWeight(s, [], 'ohp', 'increment', 1.25);
  assert.equal(s.lifts.ohp.increment, 1.25);
});

test('backup export → import round-trips, and junk files are rejected', () => {
  const s = defaultSettings();
  const W = [];
  logCycle(W, s);
  const back = readBackup(JSON.parse(JSON.stringify(makeBackup(s, W))));
  assert.equal(back.workouts.length, 6);
  assert.deepEqual(plan(back.workouts, back.settings, 0), plan(W, s, 0));
  assert.throws(() => readBackup({ hello: 1 }), /isn't a Strength Log backup/);
});

test('best sets list', () => {
  const s = defaultSettings();
  const W = [];
  logCycle(W, s);
  assert.deepEqual(
    bestSets(W, 'squat', 3).map((x) => [x.weight, x.reps]),
    [
      [105, 5],
      [100, 5],
      [95, 5],
    ]
  );
});
