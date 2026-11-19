// v6: achievements, records, then vs now.  Run with:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, planSession, workoutFromPlan, nextSessionIndex, switchBlockNow, startBlock, makeBackup, readBackup, mergeSettings } from '../js/logic.js';
import { newItem, itemSummary } from '../js/home.js';
import { pullupState, newPullupRecord } from '../js/pullups.js';
import { xpLedger } from '../js/xp.js';
import {
  ACHIEVEMENTS,
  TIER,
  achievementList,
  closest,
  sortAndFilter,
  groupByCategory,
  recordWall,
  newRecords,
  thenVsNow,
} from '../js/achievements.js';

// ---- helpers ----------------------------------------------------------------

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
let seq = 0;

/** Logs the next planned gym session. opts: { miss: true } leaves the last set of each lift at 3 reps. */
function logGym(W, s, date, opts = {}) {
  const w = workoutFromPlan(planSession(nextSessionIndex(W, s), W, s));
  for (const e of w.lifts) {
    if (e.type === 'test') e.attempts = opts.attempts ? opts.attempts(e) : [{ weight: e.oneRM, reps: 1, clean: true }];
    e.groups.forEach((g) => g.sets.forEach((x) => (x.done = true)));
    if (opts.miss) for (const g of e.groups) g.sets[g.sets.length - 1].reps = 3;
    if (e.type === '3x5') e.tough = true;
  }
  if (opts.weight) for (const e of w.lifts) if (opts.weight[e.lift] != null) e.groups[0].weight = opts.weight[e.lift];
  w.date = date;
  w.createdAt = Date.parse(date);
  Object.assign(w, opts.extra || {});
  W.push(w);
  return w;
}

/** n gym sessions every `gap` days from a start day. */
function logMany(W, s, n, y, m, d, gap = 2, opts) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(logGym(W, s, new Date(y, m - 1, d + i * gap, 18).toISOString(), opts));
  return out;
}

function logHome(W, date, items) {
  const w = { id: 'h' + ++seq, kind: 'home', date, createdAt: Date.parse(date), items, notes: '' };
  W.push(w);
  return w;
}

function logBw(W, date, kg) {
  const b = { id: 'bw' + ++seq, kind: 'bw', date, createdAt: Date.parse(date), kg };
  W.push(b);
  return b;
}

const get = (W, s, id) => achievementList(W, s, new Date(2027, 0, 1)).find((a) => a.def.id === id);
const earnedIds = (W, s) => achievementList(W, s, new Date(2027, 0, 1)).filter((a) => a.earned).map((a) => a.def.id);

// ---- the list ----------------------------------------------------------------

test('the list: tiers, XP per tier, every category from the plan, unique ids', () => {
  assert.deepEqual(
    Object.values(TIER).map((t) => [t.name, t.xp]),
    [['Bronze', 1000], ['Silver', 2500], ['Gold', 5000], ['Platinum', 10000], ['Legendary', 20000]]
  );
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  const tier = (id) => ACHIEVEMENTS.find((a) => a.id === id).tier;
  // Spot checks against the plan.
  assert.equal(tier('ratio-squat-2.25'), 'legendary');
  assert.equal(tier('ratio-bench-1.7'), 'legendary');
  assert.equal(tier('ratio-ohp-0.5'), 'bronze');
  assert.equal(tier('plates-bench-100'), 'silver');
  assert.equal(tier('plates-deadlift-220'), 'platinum');
  assert.equal(tier('plates-ohp-60'), 'bronze');
  assert.equal(tier('total-500'), 'gold');
  assert.equal(tier('streak-48'), 'platinum');
  assert.equal(tier('year-of-iron'), 'legendary');
  assert.equal(tier('kb-sinister'), 'legendary');
  assert.equal(tier('tonnage-1000'), 'platinum');
  assert.equal(ACHIEVEMENTS.filter((a) => a.cat === 'ratio').length, 20);
  assert.equal(ACHIEVEMENTS.filter((a) => a.hidden).length, 2);
  assert.equal(groupByCategory(achievementList([], defaultSettings())).length, 13);
});

// ---- bodyweight ratios, plate clubs, totals ------------------------------------

test('bodyweight ratios use the bodyweight entry closest to the day of the lift', () => {
  const s = defaultSettings(); // squat volume 100
  const W = [];
  const w1 = logGym(W, s, at(2026, 3, 2)); // A — squat 100, bench 82.5
  assert.equal(get(W, s, 'ratio-squat-1').earned, null); // no bodyweight yet
  assert.match(get(W, s, 'ratio-squat-1').note, /Log your bodyweight/);
  logBw(W, at(2026, 2, 1, 7), 95); // far away
  logBw(W, at(2026, 3, 3, 7), 100); // closest to the lift
  let a = get(W, s, 'ratio-squat-1');
  assert.deepEqual(a.earned, { date: w1.date, refId: w1.id }); // 100 / 100 = 1.0×
  // Make the closest entry heavier → the ratio drops below 1.0× and it's no longer earned.
  W.find((x) => x.kg === 100).kg = 101;
  a = get(W, s, 'ratio-squat-1');
  assert.equal(a.earned, null);
  assert.equal(a.text, '0.99× / 1.0×');
  assert.ok(a.pct >= 0.98 && a.pct <= 0.99); // 100 / 101 kg, never shown as 100% until earned
});

test('plate clubs and total clubs: exact logged weight, any clean reps, progress text', () => {
  const s = defaultSettings();
  const W = [];
  logGym(W, s, at(2026, 3, 2)); // A: squat 100, bench 82.5
  const b = logGym(W, s, at(2026, 3, 4)); // B: deadlift 120, OHP 50
  const sq = get(W, s, 'plates-squat-100');
  assert.ok(sq.earned);
  const dl = get(W, s, 'plates-deadlift-140');
  assert.equal(dl.earned, null);
  assert.equal(dl.text, '120 / 140');
  assert.equal(dl.note, 'kg');
  assert.ok(Math.abs(dl.pct - 120 / 140) < 1e-9);
  assert.deepEqual(get(W, s, 'total-300').earned, { date: b.date, refId: b.id }); // 100 + 82.5 + 120
  // A single clean rep counts; a set that wasn't ticked doesn't.
  const c = logGym(W, s, at(2026, 3, 6), { weight: { squat: 140 } });
  c.lifts[0].groups[0].sets.forEach((x, i) => (x.done = i === 0) && (x.reps = 1));
  assert.deepEqual(get(W, s, 'plates-squat-140').earned, { date: c.date, refId: c.id });
  c.lifts[0].groups[0].sets[0].done = false;
  assert.equal(get(W, s, 'plates-squat-140').earned, null);
});

// ---- XP, recalculation, closest, sorting ----------------------------------------

test('achievement XP goes in the ledger and recalculates when a workout is edited or deleted', () => {
  const s = defaultSettings();
  const W = [];
  const ws = logMany(W, s, 10, 2026, 3, 2);
  let led = xpLedger(W, s);
  const ach = led.entries.filter((e) => e.kind === 'ach');
  const ten = ach.find((e) => e.achId === 'sessions-10');
  assert.equal(ten.total, 1000);
  assert.equal(ten.refId, ws[9].id);
  assert.equal(ten.label, 'Bronze achievement: 10 gym sessions');
  assert.equal(led.total, led.entries.reduce((t, e) => t + e.total, 0));
  // Delete a workout → "10 gym sessions" and its XP are gone.
  const before = led.total;
  W.splice(3, 1);
  led = xpLedger(W, s);
  assert.equal(led.entries.find((e) => e.achId === 'sessions-10'), undefined);
  assert.ok(led.total < before - 1000);
});

test('closest 3, sorting and filters; hidden achievements only show once earned', () => {
  const s = defaultSettings();
  const W = [];
  logMany(W, s, 9, 2026, 3, 2);
  const list = achievementList(W, s);
  const near = closest(list);
  assert.equal(near.length, 3);
  assert.ok(near.every((a) => !a.earned && !a.def.hidden));
  assert.ok(near[0].pct >= near[1].pct && near[1].pct >= near[2].pct);
  const todo = list.filter((a) => !a.earned && !a.def.hidden);
  assert.ok(todo.every((a) => a.pct <= near[2].pct || near.includes(a)));
  assert.ok(near.some((a) => a.def.id === 'plates-deadlift-140')); // heavy deadlift 135 of 140 = 96%
  const notHidden = list.filter((a) => !a.def.hidden).length;
  assert.equal(sortAndFilter(list, 'easy', 'all').length, notHidden);
  const easy = sortAndFilter(list, 'easy').map((a) => a.tier.rank);
  assert.deepEqual(easy, [...easy].sort((a, b) => a - b));
  const hard = sortAndFilter(list, 'hard').map((a) => a.tier.rank);
  assert.deepEqual(hard, [...hard].sort((a, b) => b - a));
  const close = sortAndFilter(list, 'close', 'todo').map((a) => a.pct);
  assert.deepEqual(close, [...close].sort((a, b) => b - a));
  assert.ok(sortAndFilter(list, 'easy', 'done').every((a) => a.earned));
  assert.ok(sortAndFilter(list, 'easy', 'todo').every((a) => !a.earned));
  // Comrade Returns appears after a 14-day break.
  assert.ok(!sortAndFilter(achievementList(W, s)).some((a) => a.def.id === 'comrade-returns'));
  logGym(W, s, at(2026, 4, 15));
  assert.ok(sortAndFilter(achievementList(W, s)).some((a) => a.def.id === 'comrade-returns'));
});

// ---- program milestones, consistency, discipline ------------------------------------

test('program milestones: first cycle, first 5×5 block, perfect cycle, 3–5 block and new 1RMs', () => {
  const s = defaultSettings();
  const W = [];
  const ws = logMany(W, s, 24, 2026, 1, 1); // every session on its due date
  assert.equal(get(W, s, 'first-cycle').earned.refId, ws[5].id);
  assert.equal(get(W, s, 'perfect-cycle').earned.refId, ws[5].id);
  assert.equal(get(W, s, 'first-5x5').earned.refId, ws[23].id);
  assert.equal(get(W, s, 'slacker').earned, null);

  const t = startBlock(switchBlockNow(s), W, { kind: '3-5', oneRM: { squat: 140, bench: 105, deadlift: 180, ohp: 70 }, startPct: 0.65, stepPct: 0.025 });
  // Tests: squat and deadlift beat their 1RM, bench and OHP only match it.
  const beat = { squat: 145, deadlift: 185 };
  const T = [...W];
  for (let i = 0; i < 8; i++)
    logGym(T, t, at(2026, 3, 1 + i * 2), { attempts: (e) => [{ weight: beat[e.lift] || e.oneRM, reps: 1, clean: true }] });
  assert.ok(get(T, t, 'first-3-5').earned);
  assert.ok(get(T, t, 'rm-record-squat').earned);
  assert.ok(get(T, t, 'rm-record-deadlift').earned);
  assert.equal(get(T, t, 'rm-record-bench').earned, null);
  assert.equal(get(T, t, 'rm-record-ohp').earned, null);
});

test('slacker but consistent: a whole cycle with every session after its due date (hidden)', () => {
  const s = defaultSettings();
  const W = [];
  logGym(W, s, at(2026, 1, 1)); // 1st session of the cycle: first ever, counts as on time
  logMany(W, s, 5, 2026, 1, 4, 3); // 1 day late each
  assert.equal(get(W, s, 'slacker').earned, null);
  logMany(W, s, 6, 2026, 1, 22, 4); // next cycle: 2 days late each → all late
  const a = get(W, s, 'slacker');
  assert.ok(a.earned);
  assert.equal(a.def.hidden, true);
  assert.equal(get(W, s, 'perfect-cycle').earned, null);
});

test('consistency: sessions, best on-time streak, No Winter Break, Year of Iron', () => {
  const s = defaultSettings();
  const W = [];
  // Winter 2026/27: 8 sessions in each of Nov, Dec, Jan and Feb (every 3 days → on-time streak stays 1).
  logMany(W, s, 10, 2026, 11, 1, 3);
  logMany(W, s, 10, 2026, 12, 1, 3);
  logMany(W, s, 10, 2027, 1, 1, 3);
  assert.equal(get(W, s, 'no-winter-break').text, '3 / 4');
  const feb = logMany(W, s, 8, 2027, 2, 1, 3);
  assert.equal(get(W, s, 'no-winter-break').earned.refId, feb[7].id);
  assert.equal(get(W, s, 'streak-6').earned, null);
  assert.equal(get(W, s, 'sessions-10').earned.refId, W[9].id);

  const Y = [];
  const ys = logMany(Y, s, 150, 2026, 1, 1, 2); // every 2 days: 150 sessions in 299 days
  assert.equal(get(Y, s, 'year-of-iron').earned.refId, ys[149].id);
  assert.equal(get(Y, s, 'streak-48').earned.refId, ys[47].id);
  const Z = [];
  logMany(Z, s, 150, 2026, 1, 1, 3); // every 3 days: 122 in any 12 months
  assert.equal(get(Z, s, 'year-of-iron').earned, null);
  assert.equal(get(Z, s, 'year-of-iron').text, '122 / 150');
});

test('Pavel discipline: Iron Patience, Clean Block, Rest Is Training', () => {
  const s = { ...defaultSettings(), block5x5Length: 18, blocks: [{ id: 'b1', kind: '5x5', length: 18 }] };
  const W = [];
  // Volume squat/bench missed 3 times at the same weight (cycles 1–3), then done on cycle 4.
  for (let i = 0; i < 18; i++) logGym(W, s, at(2026, 1, 1 + i * 2), { miss: i % 6 === 0 });
  assert.equal(get(W, s, 'iron-patience').earned, null);
  assert.match(get(W, s, 'iron-patience').text, /3 misses at one weight/);
  assert.equal(get(W, s, 'clean-block').earned, null);
  assert.ok(get(W, s, 'rest-is-training').earned); // block of 18 finished, never on a rest day
  const s2 = startBlock(switchBlockNow({ ...s, blocks: s.blocks }), W, { kind: '5x5', length: 18 });
  const next = logGym(W, s2, at(2026, 2, 6));
  assert.equal(next.lifts[0].type, 'volume');
  assert.deepEqual(get(W, s2, 'iron-patience').earned, { date: next.date, refId: next.id });

  // A clean block: every set ticked with all its reps.
  const C = [];
  logMany(C, s, 17, 2026, 1, 1);
  assert.equal(get(C, s, 'clean-block').text, '17 / 18');
  const last = logGym(C, s, at(2026, 1, 1 + 17 * 2, 12));
  assert.equal(get(C, s, 'clean-block').earned.refId, last.id);
  // Training on a rest day in the block → no Rest Is Training.
  const R = [];
  logMany(R, s, 17, 2026, 1, 1);
  logGym(R, s, at(2026, 2, 3, 8)); // the day after the 17th session (2 Feb)
  assert.equal(get(R, s, 'rest-is-training').earned, null);
});

// ---- pull-ups, kettlebell, bodyweight skills ------------------------------------------

test('pull-ups: strict reps in one set, weighted single, program + max test, double your max', () => {
  const s = { ...defaultSettings(), pullups: { max: 5, kg: 0, at: at(2026, 1, 1, 6) } };
  const W = [];
  for (let i = 0; i < 25; i++) {
    const d = at(2026, 1, 2 + i, 7);
    const rec = newPullupRecord(pullupState(W, s, new Date(d)));
    rec.sets.forEach((x) => (x.done = true));
    logHome(W, d, [{ move: 'pullups', ...rec }]);
  }
  assert.match(get(W, s, 'pu-program').text, /25 of 25 ladders — now the max test/);
  const test = logHome(W, at(2026, 2, 1, 7), [{ move: 'pullups', mode: 'test', ladder: null, sets: [{ reps: 10, done: true }], kg: 0 }]);
  assert.equal(get(W, s, 'pu-program').earned.refId, test.id);
  assert.equal(get(W, s, 'pu-reps-10').earned.refId, test.id);
  assert.equal(get(W, s, 'pu-double').earned.refId, test.id); // 10 = 2 × 5
  // Re-setting the program keeps the first max for "Double your max".
  const s2 = { ...s, pullups: { max: 10, kg: 0, at: at(2026, 2, 2, 6), first: { max: 5, kg: 0, at: s.pullups.at } } };
  assert.equal(get(W, s2, 'pu-double').earned.refId, test.id);
  // Weighted single: +20 kg.
  const wt = logHome(W, at(2026, 2, 3, 7), [{ move: 'pullups', mode: 'free', ladder: null, sets: [{ reps: 1, done: true }], kg: 20 }]);
  assert.equal(get(W, s, 'pu-weighted-20').earned.refId, wt.id);
  assert.equal(get(W, s, 'pu-weighted-32').text, '+20 / +32');
});

test('kettlebell: press ladders, 32 kg press, Simple needs the time, Sinister 48 kg, lifetime swings', () => {
  const s = defaultSettings();
  const W = [];
  const ladders = (n, top) => Array.from({ length: n }, () => ({ top }));
  logHome(W, at(2026, 1, 1), [{ move: 'press', kg: 20, ladders: ladders(5, 4) }]);
  assert.equal(get(W, s, 'kb-press-20-ladders').text, '50 / 75');
  const p = logHome(W, at(2026, 1, 3), [{ move: 'press', kg: 24, ladders: ladders(5, 5) }]);
  assert.equal(get(W, s, 'kb-press-20-ladders').earned.refId, p.id); // 24 kg is heavier than 20
  const p32 = logHome(W, at(2026, 1, 5), [{ move: 'press', kg: 32, ladders: [{ top: 1 }] }]);
  assert.equal(get(W, s, 'kb-press-32').earned.refId, p32.id);
  assert.equal(get(W, s, 'kb-press-32x5').text, '1 / 5');

  // Simple: 100 swings in 5:00 and 10 get-ups in 10:00 with 32 kg. Without a time it doesn't count.
  const sw = (kg, sec) => ({ move: 'swings', kg, sets: [{ reps: 100 }], ...(sec ? { durationSec: sec } : {}) });
  const gu = (kg, sec) => ({ move: 'getups', kg, sets: [{ reps: 10 }], ...(sec ? { durationSec: sec } : {}) });
  logHome(W, at(2026, 2, 1), [sw(32), gu(32)]);
  assert.equal(get(W, s, 'kb-simple-swings').earned, null);
  logHome(W, at(2026, 2, 2), [sw(32, 301), gu(32, 600)]); // swings 1 s too slow
  assert.equal(get(W, s, 'kb-simple-swings').earned, null);
  assert.ok(get(W, s, 'kb-simple-getups').earned);
  assert.equal(get(W, s, 'kb-simple').earned, null);
  const simple = logHome(W, at(2026, 2, 3), [sw(32, 300), gu(32, 590)]);
  assert.equal(get(W, s, 'kb-simple').earned.refId, simple.id);
  assert.equal(get(W, s, 'kb-sinister').text, '32 / 48');
  const sinister = logHome(W, at(2026, 2, 4), [sw(48, 280), gu(48, 560)]);
  assert.equal(get(W, s, 'kb-sinister').earned.refId, sinister.id);
  assert.equal(get(W, s, 'kb-swings-10k').text, '400 / 10,000'); // 4 sessions × 100
  assert.equal(itemSummary(sw(32, 285)), 'Swings 100 × 32 kg in 4:45');
});

test('bodyweight skills count only full versions (no variation); endurance and tonnage', () => {
  const s = defaultSettings();
  const W = [];
  logHome(W, at(2026, 1, 1), [{ move: 'pistol', variation: 'to box', sets: [{ reps: 5 }] }]);
  assert.equal(get(W, s, 'pistol-1').earned, null);
  const p = logHome(W, at(2026, 1, 2), [{ move: 'pistol', variation: '', sets: [{ reps: 2 }, { reps: 3 }] }]);
  assert.equal(get(W, s, 'pistol-1').earned.refId, p.id);
  assert.equal(get(W, s, 'pistol-5').text, '3 / 5');
  assert.equal(get(W, s, 'oap-1').earned, null);

  // Warm-up runs (km or metres) and lifetime tonnage of gym sets + extras.
  const g = logGym(W, s, at(2026, 1, 3), { extra: { cardio: { type: 'run', minutes: 10, distance: 2500, unit: 'm' }, extras: [{ name: 'Curls', weight: 10, sets: [{ reps: 10, done: true }] }] } });
  logGym(W, s, at(2026, 1, 5), { extra: { cardio: { type: 'row', minutes: 10, distance: 2, unit: 'km' } } });
  assert.equal(get(W, s, 'run-100').text, '2.5 / 100');
  // Session A: squat 100 × 25 + bench 82.5 × 25 + curls 100 = 4,662.5 kg
  const tons = achievementList([g], s).find((a) => a.def.id === 'tonnage-10');
  assert.equal(tons.text, '4.6 / 10');
  assert.ok(get(W, s, 'tonnage-1').earned);
});

test('habits: bodyweight 12 weeks in a row, fed before 10 sessions in a row', () => {
  const s = defaultSettings();
  const W = [];
  for (let i = 0; i < 11; i++) logBw(W, at(2026, 1, 5 + i * 7, 7), 80); // Mondays
  logBw(W, at(2026, 1, 6, 7), 80); // a second entry in the same week doesn't add a week
  assert.equal(get(W, s, 'bw-12-weeks').earned, null);
  const twelfth = logBw(W, at(2026, 3, 29, 7), 80); // Sunday of week 12
  assert.equal(get(W, s, 'bw-12-weeks').earned.refId, twelfth.id);

  const F = [];
  logMany(F, s, 9, 2026, 1, 1, 2, { extra: { fed: true } });
  logGym(F, s, at(2026, 1, 19), { extra: { fed: false } });
  logMany(F, s, 9, 2026, 1, 21, 2, { extra: { fed: true } });
  assert.equal(get(F, s, 'fed-10').earned, null);
  assert.equal(get(F, s, 'fed-10').text, '9 / 10');
  const tenth = logGym(F, s, at(2026, 2, 8), { extra: { fed: true } });
  assert.equal(get(F, s, 'fed-10').earned.refId, tenth.id);
});

// ---- records and then vs now --------------------------------------------------------

test('record wall: best weight for at least 1, 3 and 5 clean reps; first day kept; new records', () => {
  const s = defaultSettings();
  const W = [];
  const a1 = logGym(W, s, at(2026, 1, 1)); // squat 100 × 5
  logGym(W, s, at(2026, 1, 3)); // B — Volume
  const heavy = logGym(W, s, at(2026, 1, 5)); // A — Heavy: squat top set 105 × 5
  let wall = recordWall(W);
  assert.deepEqual([wall.squat[1].weight, wall.squat[3].weight, wall.squat[5].weight], [105, 105, 105]);
  assert.equal(wall.squat[5].refId, heavy.id);
  assert.deepEqual(newRecords(W, heavy.id).filter((r) => r.lift === 'squat').map((r) => [r.reps, r.weight, r.prev]), [[1, 105, 100], [3, 105, 100], [5, 105, 100]]);
  assert.deepEqual(newRecords(W, a1.id), []); // the first time isn't a "new record"
  // A clean 1RM single counts for the 1-rep record only; a not-clean one doesn't count.
  const t = { id: 'test1', kind: 'gym', date: at(2026, 1, 9), createdAt: 1, sessionIndex: 0, lifts: [{ lift: 'squat', type: 'test', groups: [], attempts: [{ weight: 130, reps: 1, clean: true }, { weight: 140, reps: 1, clean: false }] }] };
  W.push(t);
  wall = recordWall(W);
  assert.equal(wall.squat[1].weight, 130);
  assert.equal(wall.squat[3].weight, 105);
});

test('then vs now: first logged top set vs best ever; bodyweight first vs latest', () => {
  const s = defaultSettings();
  const W = [];
  logGym(W, s, at(2026, 1, 1)); // squat 100 × 5
  logGym(W, s, at(2026, 1, 3));
  logGym(W, s, at(2026, 1, 5), { weight: { squat: 120 }, miss: true }); // A — Heavy at 120, last set 3 reps
  logGym(W, s, at(2026, 1, 7));
  logGym(W, s, at(2026, 1, 9)); // A — Unload (lighter): doesn't make "now" look worse
  logBw(W, at(2026, 1, 1, 7), 84.2);
  logBw(W, at(2026, 1, 8, 7), 83.5);
  const t = thenVsNow(W);
  const sq = t.lifts.find((l) => l.lift === 'squat');
  assert.deepEqual([sq.then.weight, sq.then.reps], [100, 5]);
  assert.deepEqual([sq.now.weight, sq.now.reps], [120, 3]);
  assert.equal(sq.diff, 20);
  assert.deepEqual([t.bw.then.kg, t.bw.now.kg, t.bw.diff], [84.2, 83.5, -0.7]);
  assert.deepEqual(thenVsNow([]), { lifts: [], bw: null });
});

// ---- upgrade ---------------------------------------------------------------------------

test('upgrade from v5 keeps every record and works out achievements for what is already logged', () => {
  const s = { ...defaultSettings(), name: 'Me', gameMode: true, pullups: { max: 6, kg: 0, at: at(2026, 1, 1, 6) } };
  const W = [];
  logMany(W, s, 12, 2026, 1, 2, 2, { extra: { fed: true } });
  logBw(W, at(2026, 1, 3, 7), 82.4);
  logHome(W, at(2026, 1, 5, 7), [newItem('swings', W), newItem('getups', W), newItem('press', W)]);
  const file = JSON.parse(JSON.stringify({ ...makeBackup(s, W), version: 5 }));
  const back = readBackup(file);
  assert.deepEqual(back.workouts, W);
  assert.deepEqual(back.settings, mergeSettings(s));
  const ids = earnedIds(back.workouts, back.settings);
  assert.ok(ids.includes('sessions-10'));
  assert.ok(ids.includes('first-cycle'));
  assert.ok(ids.includes('plates-squat-100'));
  assert.ok(xpLedger(back.workouts, back.settings).entries.some((e) => e.kind === 'ach'));
  assert.equal(makeBackup(s, W).version, 6);
});
