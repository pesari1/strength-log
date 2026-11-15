// v4: home sessions and the pull-up program.  Run with:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings,
  planSession,
  workoutFromPlan,
  nextSessionIndex,
  schedule,
  blockStatus,
  currentWeights,
} from '../js/logic.js';
import { newItem, addSet, homeItems, ladderReps, ladderText, pressProgress, homeProgress } from '../js/home.js';
import { pickProgram, pullupState, newPullupRecord, pullupRecords } from '../js/pullups.js';

// ---- helpers ----------------------------------------------------------------

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
let seq = 0;

function logGym(W, s, date, pullups) {
  const w = workoutFromPlan(planSession(nextSessionIndex(W, s), W, s));
  for (const e of w.lifts) e.groups.forEach((g) => g.sets.forEach((x) => (x.done = true)));
  w.date = date;
  w.createdAt = Date.parse(date);
  if (pullups) w.pullups = pullups;
  W.push(w);
  return w;
}

function logHome(W, date, items) {
  const w = { id: 'h' + ++seq, kind: 'home', date, createdAt: Date.parse(date), items, notes: '' };
  W.push(w);
  return w;
}

/** Log today's pull-up session at home. miss: index of a set to log one rep short. */
function logPu(W, s, date, { miss, src = 'home', reps } = {}) {
  const st = pullupState(W, s, new Date(date));
  const rec = newPullupRecord(st);
  rec.sets.forEach((x, i) => {
    x.done = true;
    if (miss === i) x.reps -= 1;
  });
  if (reps != null) rec.sets[0].reps = reps; // max test
  if (src === 'gym') return logGym(W, s, date, rec);
  logHome(W, date, [{ move: 'pullups', ...rec }]);
  return rec;
}

const withPullups = (max, kg = 0) => ({ ...defaultSettings(), pullups: { max, kg, at: at(2026, 1, 1, 6) } });
const day = (i) => at(2026, 3, 1 + i, 7); // one session per calendar day
const ladderOn = (W, s, i) => pullupState(W, s, new Date(day(i))).ladder;

// ---- 1. golden rule ------------------------------------------------------------

test('1. home sessions and pull-ups never change the gym sequence, weights, due dates or block counts', () => {
  const s = withPullups(8);
  const W = [];
  for (let i = 0; i < 9; i++) logGym(W, s, at(2026, 10, 1 + i * 2));
  const now = new Date(2026, 9, 18, 9);
  const snap = () =>
    JSON.stringify({
      next: nextSessionIndex(W, s),
      plans: [0, 1, 2, 3, 4, 5].map((i) => planSession(i, W, s)),
      sc: (({ next, due, isRestDay, daysSinceLast, upcoming }) => ({ next, due, isRestDay, daysSinceLast, upcoming }))(schedule(W, s, now)),
      block: blockStatus(W, s).text,
      weights: currentWeights(W, s),
    });
  const before = snap();

  // Home sessions of every kind, including on the day after the last gym session.
  logHome(W, at(2026, 10, 18, 7), [newItem('warmup', W), newItem('swings', W), newItem('getups', W)]);
  logHome(W, at(2026, 10, 18, 12), [newItem('press', W), newItem('pistol', W), newItem('oap', W), newItem('plank', W)]);
  logHome(W, at(2026, 10, 18, 15), [{ ...newItem('custom', W), name: 'Curls', kg: 12 }]);
  logPu(W, s, at(2026, 10, 18, 20));
  assert.equal(snap(), before);

  // Pull-ups inside a gym workout don't change the gym plan either.
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    logGym(A, s, at(2026, 10, 1 + i * 2));
    logGym(B, s, at(2026, 10, 1 + i * 2), newPullupRecord(pullupState(B, s, new Date(2026, 9, 1 + i * 2))));
  }
  for (const i of [0, 2, 4]) assert.deepEqual(planSession(i, A, s).lifts, planSession(i, B, s).lifts);
  assert.equal(blockStatus(A, s).text, blockStatus(B, s).text);
});

// ---- 2. presets remember last values; +1 set -----------------------------------------

test('2. movements pre-fill the last values used; "+1 set" adds a set with the time', () => {
  const W = [];
  // Defaults the first time.
  assert.deepEqual(newItem('swings', W), { move: 'swings', kg: 20, sets: [{ reps: 100 }] });
  assert.deepEqual(newItem('getups', W), { move: 'getups', kg: 20, sets: [{ reps: 10 }] });
  assert.deepEqual(newItem('plank', W).sets, [{ secs: 10 }, { secs: 10 }, { secs: 10 }]);

  const pistol = { move: 'pistol', variation: 'to box', sets: [{ reps: 3 }, { reps: 3 }] };
  addSet(pistol, new Date(2026, 2, 3, 14, 5)); // a practice set later in the day
  logHome(W, at(2026, 3, 3, 8), [
    { move: 'swings', kg: 24, sets: [{ reps: 120 }] },
    pistol,
    { move: 'press', kg: 16, ladders: [{ top: 3 }, { top: 3 }, { top: 3 }] },
    { move: 'custom', name: 'Curls', kg: 12, sets: [{ reps: 8 }, { reps: 8 }] },
  ]);
  assert.equal(pistol.sets.length, 3);
  assert.equal(pistol.sets[2].reps, 3);
  assert.equal(pistol.sets[2].time, new Date(2026, 2, 3, 14, 5).toISOString());

  assert.deepEqual(newItem('swings', W), { move: 'swings', kg: 24, sets: [{ reps: 120 }] });
  assert.deepEqual(newItem('pistol', W), { move: 'pistol', variation: 'to box', sets: [{ reps: 3 }, { reps: 3 }] }); // practice set not carried over
  assert.deepEqual(newItem('press', W), { move: 'press', kg: 16, ladders: [{ top: 3 }, { top: 3 }, { top: 3 }] });
  assert.deepEqual(newItem('custom', W, { name: 'curls' }), { move: 'custom', kg: 12, name: 'curls', sets: [{ reps: 8 }, { reps: 8 }] });
  assert.equal(newItem('custom', W, { name: 'Dips' }).kg, null); // a new custom name starts fresh

  // +1 ladder for press.
  const p = newItem('press', W);
  addSet(p, new Date(2026, 2, 4, 9));
  assert.equal(ladderText(p.ladders), '4 × 1-2-3');
  assert.equal(ladderReps(p.ladders), 24);
  assert.equal(p.ladders[3].time, new Date(2026, 2, 4, 9).toISOString());

  // Press progress: just shown, no next step calculated.
  const pp = pressProgress(W, 16);
  assert.equal(pp.last.text, '3 × 1-2-3 with 16 kg');
  assert.equal(pp.goalText, '5 ladders of 1-2-3-4-5 per arm');
  assert.equal(pp.goalReps, 75);
  assert.equal(pp.reached, false);

  // v3 home sessions (swings/get-ups fields) still read and pre-fill.
  const V = [{ id: 'old', kind: 'home', date: at(2026, 1, 2), swings: { reps: 100, kg: 28 }, getups: { reps: 10, kg: 24 } }];
  assert.deepEqual(homeItems(V[0]).map((i) => [i.move, i.kg]), [['swings', 28], ['getups', 24]]);
  assert.equal(newItem('swings', V).kg, 28);
  assert.equal(homeProgress(V, 'swings').charts[0].points[0].value, 28);
});

// ---- 3. picking the pull-up program ---------------------------------------------------

test('3. pull-up setup picks the right program for max 3, 5, 8, 14', () => {
  const TABLE = [[3, 2, 1, 1, 1]];
  assert.equal(pickProgram(3, TABLE).id, '3rm');
  assert.equal(pickProgram(4, TABLE).id, '3rm');
  assert.equal(pickProgram(3, null).id, 'free'); // until the published table is added
  assert.equal(pickProgram(3, null).wants, '3rm');
  assert.deepEqual(pickProgram(5).base, [5, 4, 3, 2, 1]);
  assert.deepEqual(pickProgram(8).base, [8, 7, 6, 5, 4]);
  assert.equal(pickProgram(12).id, '5rm');
  assert.equal(pickProgram(14).id, '15rm');
  assert.deepEqual(pickProgram(14).base, [12, 10, 8, 6, 4]);
  assert.equal(pickProgram(2).id, 'free'); // max 1–2: no program, just log
  assert.equal(pickProgram(0).id, 'free');
  assert.equal(pullupState([], defaultSettings()).phase, 'setup');
});

// ---- 4. 5RM pattern ------------------------------------------------------------------------

test('4. 5RM pattern: 5,4,3,2,1 / 5,4,3,2,2 / 5,4,3,3,2 / 5,4,4,3,2 / 5,5,4,3,2 / then 6,5,4,3,2', () => {
  const s = withPullups(5);
  const W = [];
  const got = [];
  for (let i = 0; i < 6; i++) {
    got.push(ladderOn(W, s, i).join(','));
    logPu(W, s, day(i));
  }
  assert.deepEqual(got, ['5,4,3,2,1', '5,4,3,2,2', '5,4,3,3,2', '5,4,4,3,2', '5,5,4,3,2', '6,5,4,3,2']);
  // Day off the calendar day after every 5th session.
  const W2 = [];
  for (let i = 0; i < 5; i++) logPu(W2, s, day(i));
  const off = pullupState(W2, s, new Date(day(5)));
  assert.equal(off.dayOff, true);
  assert.equal(off.text, 'day off');
  assert.equal(pullupState(W2, s, new Date(day(6))).dayOff, false);
  assert.equal(pullupState(W2, s, new Date(day(6))).text, "today's ladder: 6, 5, 4, 3, 2");
  // Max 8 starts at 8,7,6,5,4.
  assert.deepEqual(ladderOn([], withPullups(8), 0), [8, 7, 6, 5, 4]);
});

// ---- 5. 15RM pattern ------------------------------------------------------------------------

test('5. 15RM pattern: 12,10,8,6,4 → … → 14,12,10,8,6', () => {
  const s = withPullups(14);
  const W = [];
  const got = [];
  for (let i = 0; i < 6; i++) {
    got.push(ladderOn(W, s, i).join(','));
    logPu(W, s, day(i));
  }
  assert.deepEqual(got, ['12,10,8,6,4', '12,10,8,6,6', '12,10,8,8,6', '12,10,10,8,6', '12,12,10,8,6', '14,12,10,8,6']);
});

// ---- 6. missed reps --------------------------------------------------------------------------

test('6. missed reps → the same ladder next session (and it does not count)', () => {
  const s = withPullups(5);
  const W = [];
  logPu(W, s, day(0));
  logPu(W, s, day(1), { miss: 4 }); // 5,4,3,2,1 instead of 5,4,3,2,2
  let st = pullupState(W, s, new Date(day(2)));
  assert.deepEqual(st.ladder, [5, 4, 3, 2, 2]);
  assert.ok(st.missed);
  logPu(W, s, day(2), { miss: 0 });
  assert.deepEqual(ladderOn(W, s, 3), [5, 4, 3, 2, 2]);
  logPu(W, s, day(3)); // done now
  st = pullupState(W, s, new Date(day(4)));
  assert.deepEqual(st.ladder, [5, 4, 3, 3, 2]);
  assert.equal(st.progress, 'Week 1, session 3 · 2 of 25 done');
});

// ---- 7. 25 sessions → max test → new cycle -------------------------------------------------

test('7. after 25 completed sessions → max test → new cycle from the new max', () => {
  const s = withPullups(5);
  const W = [];
  for (let i = 0; i < 25; i++) logPu(W, s, day(i));
  let st = pullupState(W, s, new Date(day(26)));
  assert.equal(st.phase, 'test');
  assert.equal(st.text, 'take a few rest days, then test your max');
  assert.equal(newPullupRecord(st).mode, 'test');
  logPu(W, s, day(29), { reps: 9 }); // tested max: 9
  st = pullupState(W, s, new Date(day(30)));
  assert.equal(st.phase, 'ladder');
  assert.equal(st.max, 9);
  assert.deepEqual(st.ladder, [9, 8, 7, 6, 5]);
  assert.deepEqual(st.tests.map((t) => [t.max, t.source]), [[5, 'setup'], [9, 'test']]);
  // A new max of 13+ moves to the 15RM program.
  for (let i = 30; i < 55; i++) logPu(W, s, day(i));
  logPu(W, s, day(58), { reps: 13 });
  assert.deepEqual(pullupState(W, s, new Date(day(59))).ladder, [12, 10, 8, 6, 4]);
});

// ---- 8. one session per calendar day ----------------------------------------------------------

test('8. pull-ups at the gym and at home on the same day → only the first counts', () => {
  const s = withPullups(5);
  const W = [];
  logPu(W, s, at(2026, 3, 1, 7), { src: 'gym' }); // gym, morning
  logPu(W, s, at(2026, 3, 1, 19)); // home, evening, same day
  const recs = pullupRecords(W);
  assert.deepEqual(recs.map((r) => [r.src, r.counts]), [['gym', true], ['home', false]]);
  assert.deepEqual(pullupState(W, s, new Date(2026, 2, 2)).ladder, [5, 4, 3, 2, 2]); // advanced once
  assert.equal(pullupState(W, s, new Date(2026, 2, 1, 21)).doneToday, true);
});

// ---- extras ------------------------------------------------------------------------------------

test("3RM program: Pavel's published days 1–12 with days 6 and 12 off, then the 5RM program", () => {
  assert.equal(pickProgram(3).id, '3rm');
  assert.equal(pickProgram(4).id, '3rm');
  const s = withPullups(3);
  const W = [];
  const got = [];
  // Train on days 1–5, 7–11 (days 6 and 12 are the program's days off).
  for (const d of [1, 2, 3, 4, 5]) {
    got.push(`Day ${d}: ${ladderOn(W, s, d).join(', ')}`);
    logPu(W, s, day(d));
  }
  const off6 = pullupState(W, s, new Date(day(6)));
  assert.equal(off6.dayOff, true);
  assert.equal(off6.text, 'day off');
  for (const d of [7, 8, 9, 10, 11]) {
    got.push(`Day ${d}: ${ladderOn(W, s, d).join(', ')}`);
    logPu(W, s, day(d));
  }
  assert.deepEqual(got, [
    'Day 1: 3, 2, 1, 1',
    'Day 2: 3, 2, 1, 1',
    'Day 3: 3, 2, 2, 1',
    'Day 4: 3, 3, 2, 1',
    'Day 5: 4, 3, 2, 1',
    'Day 7: 4, 3, 2, 1, 1',
    'Day 8: 4, 3, 2, 2, 1',
    'Day 9: 4, 3, 3, 2, 1',
    'Day 10: 4, 4, 3, 2, 1',
    'Day 11: 5, 4, 3, 2, 1',
  ]);
  assert.equal(pullupState(W, s, new Date(day(12))).dayOff, true); // day 12: off
  const next = pullupState(W, s, new Date(day(13)));
  assert.equal(next.program.id, '5rm');
  assert.deepEqual(next.ladder, [5, 4, 3, 2, 1]); // then the 5RM program
  assert.equal(next.progress, 'Week 1, session 1 · 0 of 25 done');

  // Missed reps in the 3RM program → the same day again.
  const M = [];
  logPu(M, s, day(1));
  logPu(M, s, day(2), { miss: 3 });
  assert.deepEqual(ladderOn(M, s, 3), [3, 2, 1, 1]);
  assert.equal(pullupState(M, s, new Date(day(3))).progress, '3RM program · session 2 of 10');
});

test('pull-up notes and records: 14+ day note, free logging for max 1–2, old pull-ups ignored', () => {
  const s = withPullups(6);
  const W = [];
  // Pull-ups logged in v1–v3 gym workouts (no program) don't move the program.
  W.push({ id: 'old', kind: 'gym', date: at(2026, 2, 27), createdAt: Date.parse(at(2026, 2, 27)), lifts: [], pullups: { sets: [{ reps: 5, done: true }] } });
  logPu(W, s, day(0));
  assert.deepEqual(ladderOn(W, s, 1), [6, 5, 4, 3, 3]);
  assert.equal(pullupState(W, s, new Date(day(13))).longBreakNote, null);
  assert.equal(pullupState(W, s, new Date(day(14))).longBreakNote, '14 days since last pull-up session');
  assert.deepEqual(pullupState(W, s, new Date(day(30))).ladder, [6, 5, 4, 3, 3]); // just continues

  const f = withPullups(2);
  const st = pullupState([], f);
  assert.equal(st.phase, 'free');
  assert.equal(st.text, 'log freely');
  assert.equal(newPullupRecord(st).mode, 'free');
});
