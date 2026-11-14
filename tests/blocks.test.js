// v3: block rotation and the 3–5 method.  Run with:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings,
  planSession,
  workoutFromPlan,
  nextSessionIndex,
  schedule,
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

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
const day = (iso) => {
  const x = new Date(iso);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
};
let clock = new Date(2026, 0, 5, 18).getTime();
const nextDay = (days = 2) => new Date((clock += days * 86400000)).toISOString();

const ONE_RM = { squat: 140, bench: 105, deadlift: 180, ohp: 70 };

function plan(W, s, index) {
  return Object.fromEntries(planSession(index, W, s).lifts.map((l) => [l.lift, l]));
}
const tfPlan = (W, s) => plan(W, s, nextSessionIndex(W, s));

/** Log a 5×5-block session as recommended (all reps made). weight: { liftId: first-group weight } */
function log(W, s, index, { weight = {}, date } = {}) {
  const w = workoutFromPlan(planSession(index, W, s));
  for (const e of w.lifts)
    e.groups.forEach((g, gi) => {
      if (gi === 0 && weight[e.lift] != null) g.weight = weight[e.lift];
      g.sets.forEach((x) => (x.done = true));
    });
  w.date = date || nextDay();
  w.createdAt = Date.parse(w.date);
  W.push(w);
  return w;
}
const logCycle = (W, s) => {
  for (let i = 0; i < 6; i++) log(W, s, i);
};

/** Log the next 3–5 session. Per-lift options: reps, weight, tough, attempts. */
function logTf(W, s, opts = {}, date) {
  const w = workoutFromPlan(planSession(nextSessionIndex(W, s), W, s));
  for (const e of w.lifts) {
    const o = opts[e.lift] || {};
    if (e.type === 'test') {
      e.attempts = o.attempts || [];
      continue;
    }
    const g = e.groups[0];
    if (o.weight != null) g.weight = o.weight;
    g.sets.forEach((x, i) => {
      x.done = true;
      if (o.reps) x.reps = o.reps[i];
    });
    if (e.type === '3x5') e.tough = !!o.tough;
  }
  w.date = date || nextDay();
  w.createdAt = Date.parse(w.date);
  W.push(w);
  return w;
}

function startTf(W, s, oneRM = ONE_RM, extra = {}) {
  return startBlock(switchBlockNow(s), W, { kind: '3-5', oneRM, startPct: 0.65, stepPct: 0.025, ...extra });
}

// ---- tests --------------------------------------------------------------------

test("v3-3. 5×5 block ends after exactly 24 gym workouts (old ones count, S&S doesn't, deleting lowers the count)", () => {
  const s = defaultSettings();
  const W = [];
  for (let i = 0; i < 20; i++) delete log(W, s, i % 6).block; // logged before blocks existed
  W.push({ id: 'kb1', kind: 'home', date: nextDay(1), swings: { reps: 100, kg: 20 } });
  W.push({ id: 'kb2', kind: 'home', date: nextDay(1), swings: { reps: 100, kg: 20 } });
  let st = blockStatus(W, s);
  assert.equal(st.count, 20);
  assert.equal(st.text, '5×5 block — workout 21 of 24');
  for (let i = 20; i < 23; i++) log(W, s, i % 6);
  st = blockStatus(W, s);
  assert.equal(st.text, '5×5 block — workout 24 of 24');
  assert.equal(st.done, false);
  log(W, s, 23 % 6);
  st = blockStatus(W, s);
  assert.equal(st.done, true);
  assert.equal(st.next, '3-5');
  assert.equal(schedule(W, s).nextName, 'A — 3–5');
  W.splice(3, 1); // delete one workout
  assert.equal(blockStatus(W, s).count, 23);
  assert.equal(blockStatus(W, s).done, false);
  // Length is editable in whole cycles.
  const s18 = { ...s, blocks: [{ ...s.blocks[0], length: 18 }] };
  assert.equal(blockStatus(W, s18).done, true);
});

test('v3-4. gaps and rest days inside a block behave as before; dates never change block progress', () => {
  const s = defaultSettings();
  const A = [];
  const B = [];
  for (let i = 0; i < 10; i++) log(A, s, i % 6, { date: at(2026, 9, 1 + i * 2) });
  for (let i = 0; i < 10; i++) log(B, s, i % 6, { date: at(2026, 9 + Math.floor(i / 4), 1 + i) }); // gaps, odd spacing
  assert.equal(blockStatus(A, s).text, blockStatus(B, s).text);

  // Inside a 3–5 block.
  const W = [];
  for (let i = 0; i < 24; i++) log(W, s, i % 6, { date: at(2026, 8, 1) });
  const t = startTf(W, s);
  logTf(W, t, {}, at(2026, 11, 17)); // A on Tuesday
  let sc = schedule(W, t, new Date(2026, 10, 18, 8)); // Wednesday
  assert.equal(sc.isRestDay, true);
  assert.equal(day(sc.due), '2026-11-19');
  assert.equal(sc.nextName, 'B — 3–5');
  assert.deepEqual(
    sc.upcoming.map((u) => u.name),
    ['B — 3–5', 'A — 3–5', 'B — 3–5']
  );
  const before = tfPlan(W, t);
  sc = schedule(W, t, new Date(2026, 11, 10, 8)); // 3 weeks later
  assert.equal(sc.longBreak, true);
  assert.equal(sc.nextName, 'B — 3–5'); // not skipped
  assert.deepEqual(tfPlan(W, t), before); // weights unchanged by the gap
  assert.equal(blockStatus(W, t).text, '3–5 block — squat: 3×5 #2, bench: 3×5 #2, deadlift: 3×5 #1, OHP: 3×5 #1');
});

test('v3-5. 3–5 block: first session 65% of 1RM, +2.5% of 1RM each session, rounded', () => {
  const s = defaultSettings();
  const W = [];
  const t = startTf(W, s);
  let p = tfPlan(W, t);
  assert.equal(p.squat.type, '3x5');
  assert.equal(p.squat.groups[0].sets, 3);
  assert.equal(p.squat.groups[0].target, 5);
  assert.equal(p.squat.groups[0].weight, 90); // 140 × 65% = 91 → 90
  assert.equal(p.squat.notes[0], '3×5 at 65% of 1RM 140 = 91 → 90 kg');
  assert.equal(p.bench.groups[0].weight, 67.5); // 68.25 → 67.5
  logTf(W, t);
  p = tfPlan(W, t); // B day
  assert.equal(p.deadlift.groups[0].weight, 117.5); // 117 → 117.5
  assert.equal(p.ohp.groups[0].weight, 45); // 45.5 → 45
  logTf(W, t);
  p = tfPlan(W, t); // A day again
  assert.equal(p.squat.groups[0].weight, 92.5); // 90 + 3.5 = 93.5 → 92.5
  assert.equal(p.squat.notes[0], 'Last 3×5: 90 kg 5,5,5 → +2.5% of 1RM = 93.5 → 92.5 kg');
  assert.equal(p.bench.groups[0].weight, 70); // 67.5 + 2.625 = 70.125 → 70

  // The rounding setting is used (1.25 kg plates).
  const t2 = { ...t, rounding: 1.25 };
  assert.equal(plan([], t2, 0).squat.groups[0].weight, 91.25);
  assert.equal(plan([], t2, 0).bench.groups[0].weight, 68.75);
});

test('v3-6. tough or missed reps → 3×3; missed triple repeats; two 3×3 → 1RM test; then restart at 65% of the new 1RM', () => {
  const s = defaultSettings();
  const W = [];
  const t = startTf(W, s);
  logTf(W, t, { bench: { reps: [5, 5, 4] } }); // A1: squat fine, bench missed a rep
  logTf(W, t); // B1
  let p = tfPlan(W, t);
  assert.equal(p.squat.type, '3x5');
  assert.equal(p.bench.type, '3x3'); // fewer than 5 reps → triples
  assert.equal(p.bench.groups[0].target, 3);
  assert.equal(p.bench.groups[0].weight, 70); // still +2.5% of 1RM
  assert.equal(p.bench.notes[0], 'Last 3×5: 67.5 kg 5,5,4 — missed reps → triples, +2.5% of 1RM = 70.125 → 70 kg');

  logTf(W, t, { squat: { tough: true } }); // A2: squat 92.5 "tough"
  logTf(W, t);
  p = tfPlan(W, t);
  assert.equal(p.squat.type, '3x3');
  assert.equal(p.squat.groups[0].weight, 95); // 96 → 95
  assert.equal(p.squat.notes[0], 'Last 3×5: 92.5 kg 5,5,5 — tough → triples, +2.5% of 1RM = 96 → 95 kg');

  logTf(W, t, { squat: { reps: [3, 3, 2] } }); // A3: missed a triple
  logTf(W, t);
  p = tfPlan(W, t);
  assert.equal(p.squat.type, '3x3');
  assert.equal(p.squat.groups[0].weight, 95); // repeat
  assert.equal(p.squat.notes[0], 'Last 3×3: 95 kg 3,3,2 — missed a triple → repeat 95 kg');

  logTf(W, t); // A4: triples 1 of 2
  logTf(W, t);
  p = tfPlan(W, t);
  assert.equal(p.squat.groups[0].weight, 97.5); // 98.5 → 97.5
  assert.equal(p.squat.notes[0], 'Triples 1 of 2 done → +2.5% of 1RM = 98.5 → 97.5 kg');
  logTf(W, t); // A5: triples 2 of 2
  logTf(W, t);
  p = tfPlan(W, t);
  assert.equal(p.squat.type, 'test');
  assert.equal(p.squat.notes[0], '1RM test: work up to a conservative 1RM — perfect technique only. Current 1RM 140 kg.');

  logTf(W, t, {
    squat: {
      attempts: [
        { weight: 120, reps: 1, clean: true },
        { weight: 130, reps: 1, clean: true },
        { weight: 135, reps: 1, clean: false }, // not clean → doesn't count
      ],
    },
  }); // A6: test
  logTf(W, t);
  p = tfPlan(W, t);
  assert.equal(p.squat.type, '3x5');
  assert.equal(p.squat.groups[0].weight, 85); // 65% of new 1RM 130 = 84.5 → 85
  assert.equal(p.squat.notes[0], 'New 1RM 130 → 3×5 at 65% = 84.5 → 85 kg');
  assert.match(blockStatus(W, t).text, /squat: tested ✓/);
  assert.deepEqual(
    oneRMHistory(W, t, 'squat').map((x) => [x.weight, x.source]),
    [
      [140, 'entered'],
      [130, 'tested'],
    ]
  );

  // A clean double counts as a single; no clean single → old 1RM kept, still counts as tested.
  const W2 = [];
  const t2 = startTf(W2, s);
  for (const reps of [[5, 5, 4], [3, 3, 3], [3, 3, 3]]) {
    logTf(W2, t2, { squat: { reps }, bench: { reps } });
    logTf(W2, t2);
  }
  assert.equal(tfPlan(W2, t2).squat.type, 'test');
  logTf(W2, t2, { squat: { attempts: [{ weight: 145, reps: 2, clean: true }] }, bench: { attempts: [] } });
  const st = blockStatus(W2, t2).lifts;
  assert.equal(st.squat.oneRM, 145);
  assert.equal(st.bench.oneRM, 105);
  assert.equal(st.bench.tested, true);
  logTf(W2, t2);
  assert.equal(tfPlan(W2, t2).bench.notes[0], 'No clean single — 1RM stays 105 → 3×5 at 65% = 68.25 → 67.5 kg');
});

test('v3-7. 3–5 block ends only when all four lifts have tested; then 5×5 continues where it left off', () => {
  const s = defaultSettings();
  const W = [];
  for (let c = 0; c < 4; c++) logCycle(W, s); // 24 workouts, every rep made
  assert.equal(blockStatus(W, s).done, true);
  const prop = proposeNextBlock(W, s);
  assert.equal(prop.kind, '3-5');
  assert.deepEqual(prop.oneRM, { squat: null, bench: 105, deadlift: null, ohp: null }); // first time
  assert.throws(() => startBlock(s, W, prop), /enter a 1RM for Squat/);

  const t = startBlock(s, W, { ...prop, oneRM: ONE_RM });
  assert.equal(blockStatus(W, t).text, '3–5 block — squat: 3×5 #1, bench: 3×5 #1, deadlift: 3×5 #1, OHP: 3×5 #1');
  const tough = { squat: { tough: true }, bench: { tough: true }, deadlift: { tough: true }, ohp: { tough: true } };
  logTf(W, t, tough); // A 3×5 → triples
  logTf(W, t, tough); // B
  for (let i = 0; i < 4; i++) logTf(W, t); // two rounds of triples
  logTf(W, t, { squat: { attempts: [{ weight: 150, reps: 1, clean: true }] } }); // A: squat & bench test
  let st = blockStatus(W, t);
  assert.equal(st.done, false);
  assert.equal(st.text, '3–5 block — squat: tested ✓, bench: tested ✓, deadlift: 1RM test next, OHP: 1RM test next');
  logTf(W, t); // B: deadlift & OHP test (no attempts → keep 1RMs)
  st = blockStatus(W, t);
  assert.equal(st.done, true);
  assert.equal(st.next, '5x5');

  const back = proposeNextBlock(W, t);
  assert.equal(back.kind, '5x5');
  assert.equal(back.length, 24);
  assert.deepEqual(back.weights.squat, { volume: 120, heavy: 125 }); // 100 + 4×5, 105 + 4×5
  assert.deepEqual(back.weights.bench, { volume: 92.5, heavy: 97.5 });
  const f = startBlock(t, W, back);
  assert.equal(currentBlock(f).kind, '5x5');
  assert.equal(nextSessionIndex(W, f), 0); // starts at A Volume
  assert.equal(plan(W, f, 0).squat.groups[0].weight, 120);
  assert.equal(blockStatus(W, f).text, '5×5 block — workout 1 of 24');
  assert.equal(blockLabel(currentBlock(f).id, f), '5×5 block 2');

  // Next time round, the 3–5 block offers the 1RMs from the last test.
  assert.deepEqual(proposeNextBlock(W, switchBlockNow(f)).oneRM, { squat: 150, bench: 105, deadlift: 180, ohp: 70 });
});

test('v3-8. block start screen values become the starting weights; overrides still win', () => {
  const s = defaultSettings();
  const W = [];
  for (let c = 0; c < 4; c++) logCycle(W, s);
  // 3–5: edited 1RM and start %.
  const t = startTf(W, s, { ...ONE_RM, bench: 100 }, { startPct: 0.7 });
  let p = tfPlan(W, t);
  assert.equal(p.bench.groups[0].weight, 70); // 70% of 100
  assert.equal(p.squat.groups[0].weight, 97.5); // 98 → 97.5
  logTf(W, t, { bench: { weight: 72.5 } }); // lifted more than planned
  logTf(W, t);
  assert.equal(tfPlan(W, t).bench.groups[0].weight, 75); // 72.5 + 2.5
  // Out-of-range percentages are kept within Pavel's ranges.
  const t2 = startTf([], s, ONE_RM, { startPct: 0.8, stepPct: 0.05 });
  assert.equal(currentBlock(t2).startPct, 0.7);
  assert.equal(currentBlock(t2).stepPct, 0.03);

  // Back to 5×5 with an edited starting weight.
  const f = startBlock(switchBlockNow(t), W, {
    kind: '5x5',
    length: 24,
    weights: { ...proposeNextBlock(W, switchBlockNow(t)).weights, squat: { volume: 110, heavy: 125 } },
  });
  p = plan(W, f, 0);
  assert.equal(p.squat.groups[0].weight, 110);
  assert.equal(p.squat.notes[0], 'Set by you → 110 kg');
  log(W, f, 0, { weight: { squat: 112.5 } }); // override, 5×5 done
  assert.equal(plan(W, f, 0).squat.groups[0].weight, 117.5);
});

test('v3-9. switch block now / go back works and keeps all logged data', () => {
  const s = defaultSettings();
  const W = [];
  for (let i = 0; i < 10; i++) log(W, s, i % 6);
  const snapshot = JSON.stringify(W);

  let x = switchBlockNow(s);
  assert.equal(blockStatus(W, x).done, true);
  assert.equal(canUndoSwitch(W, x), 'reopen');
  x = undoSwitch(W, x);
  assert.equal(blockStatus(W, x).done, false);
  assert.equal(blockStatus(W, x).count, 10);

  x = startTf(W, s); // switched and started the 3–5 block
  assert.equal(currentBlock(x).kind, '3-5');
  assert.equal(canUndoSwitch(W, x), 'remove');
  x = undoSwitch(W, x);
  assert.equal(currentBlock(x).id, 'b1');
  assert.equal(blockStatus(W, x).text, '5×5 block — workout 11 of 24');
  assert.equal(nextSessionIndex(W, x), 4);
  assert.equal(JSON.stringify(W), snapshot);

  // Once something is logged in the new block, going back isn't offered.
  const t = startTf(W, s);
  const w = logTf(W, t);
  assert.equal(canUndoSwitch(W, t), null);
  assert.equal(undoSwitch(W, t), t);
  assert.equal(workoutTitle(w), 'A — 3–5');
  assert.equal(blockLabel(w.block, t), '3–5 block 1');
  assert.equal(blockLabel(W[0].block, t), '5×5 block 1');
});
