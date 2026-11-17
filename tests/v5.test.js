// v5: bug fixes, bodyweight, XP, levels and belts.  Run with:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings,
  mergeSettings,
  planSession,
  workoutFromPlan,
  nextSessionIndex,
  schedule,
  makeBackup,
  readBackup,
  switchBlockNow,
  startBlock,
} from '../js/logic.js';
import { newItem } from '../js/home.js';
import { pullupState, newPullupRecord, pullupRecords } from '../js/pullups.js';
import { bwDue, lastBw } from '../js/body.js';
import { xpLedger, xpFor, levelForXp, levelInfo, LEVEL_XP, beltInfo, breakdown, XP } from '../js/xp.js';

// ---- helpers ----------------------------------------------------------------

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
let seq = 0;

function logGym(W, s, date, extra = {}) {
  const w = workoutFromPlan(planSession(nextSessionIndex(W, s), W, s));
  for (const e of w.lifts) e.groups.forEach((g) => g.sets.forEach((x) => (x.done = true)));
  w.date = date;
  w.createdAt = Date.parse(date);
  Object.assign(w, extra);
  W.push(w);
  return w;
}

function logHome(W, date, items) {
  const w = { id: 'h' + ++seq, kind: 'home', date, createdAt: Date.parse(date), items, notes: '' };
  W.push(w);
  return w;
}

function ladderItem(W, s, date) {
  const rec = newPullupRecord(pullupState(W, s, new Date(date)));
  rec.sets.forEach((x) => (x.done = true));
  return { move: 'pullups', ...rec };
}

function logBw(W, date, kg) {
  const b = { id: 'bw' + ++seq, kind: 'bw', date, createdAt: Date.parse(date), kg };
  W.push(b);
  return b;
}

const withPullups = (max = 5) => ({ ...defaultSettings(), pullups: { max, kg: 0, at: at(2026, 1, 1, 6) } });
const gymEntries = (W, s) => xpLedger(W, s).entries.filter((e) => e.kind === 'gym');

// ---- 1. home sessions per day ----------------------------------------------------

test('1. several home sessions a day; one session holds several presets; only the first pull-up ladder counts', () => {
  const s = withPullups(5);
  const W = [];
  // One session: pull-up ladder + press ladders.
  const a = logHome(W, at(2026, 3, 2, 7), [ladderItem(W, s, at(2026, 3, 2, 7)), newItem('press', W)]);
  const b = logHome(W, at(2026, 3, 2, 12), [ladderItem(W, s, at(2026, 3, 2, 12)), newItem('swings', W)]);
  const c = logHome(W, at(2026, 3, 2, 19), [newItem('plank', W)]);
  assert.equal(W.filter((w) => w.kind === 'home').length, 3);
  assert.deepEqual(a.items.map((i) => i.move), ['pullups', 'press']);
  assert.deepEqual(pullupRecords(W).map((r) => [r.id, r.counts]), [[a.id, true], [b.id, false]]);
  assert.deepEqual(pullupState(W, s, new Date(2026, 2, 3)).ladder, [5, 4, 3, 2, 2]); // advanced once

  const L = xpLedger(W, s);
  assert.deepEqual(xpFor(L, a.id).map((e) => [e.label, e.total]), [['Home session', 1200], ['Pull-up ladder', 800]]);
  assert.deepEqual(xpFor(L, b.id).map((e) => [e.label, e.total]), [['Home session', 600]]); // 2nd ladder doesn't count
  assert.deepEqual(xpFor(L, c.id).map((e) => [e.label, e.total]), [['Home session', 0]]); // 3rd: logged, no XP
  // A new day starts over.
  const d = logHome(W, at(2026, 3, 3, 7), [newItem('swings', W)]);
  assert.equal(xpFor(xpLedger(W, s), d.id)[0].total, 1200);
});

// ---- 2. coming-up preview -----------------------------------------------------------

test('2. "Coming up" shows the rest of the cycle and the next; each preview is that session\'s plan', () => {
  const s = defaultSettings();
  const W = [];
  logGym(W, s, at(2026, 3, 2));
  logGym(W, s, at(2026, 3, 4)); // next is #3 A — Heavy
  const next = nextSessionIndex(W, s);
  assert.equal(next, 2);
  const sc = schedule(W, s, new Date(2026, 2, 5, 9), 12 - next); // "Show more"
  assert.deepEqual(
    sc.upcoming.map((u) => u.name),
    ['A — Heavy', 'B — Heavy', 'A — Unload', 'B — Unload', 'A — Volume', 'B — Volume', 'A — Heavy', 'B — Heavy', 'A — Unload', 'B — Unload']
  );
  const p = planSession(sc.upcoming[2].sessionIndex, W, s); // tap "A — Unload"
  assert.equal(p.name, 'A — Unload');
  assert.deepEqual(p.lifts.map((l) => [l.lift, l.groups[0].weight, l.groups[0].sets, l.groups[0].target]), [
    ['squat', 80, 5, 4],
    ['bench', 65, 5, 4],
  ]);
});

// ---- 3. bodyweight banner ---------------------------------------------------------------

test('3. bodyweight banner: due when nothing is logged or after 7 days, gone once logged', () => {
  const W = [];
  assert.equal(bwDue(W, new Date(2026, 2, 1)), true);
  logBw(W, at(2026, 3, 1, 7), 82.4);
  assert.equal(lastBw(W).kg, 82.4);
  assert.equal(bwDue(W, new Date(2026, 2, 1, 9)), false);
  assert.equal(bwDue(W, new Date(2026, 2, 7, 9)), false); // 6 days
  assert.equal(bwDue(W, new Date(2026, 2, 8, 9)), true); // 7 days
  logBw(W, at(2026, 3, 8, 7), 82.1);
  assert.equal(bwDue(W, new Date(2026, 2, 8, 9)), false);
  // Bodyweight entries never touch the gym plan.
  const s = defaultSettings();
  const G = [];
  logGym(G, s, at(2026, 3, 2));
  const before = JSON.stringify([nextSessionIndex(G, s), schedule(G, s, new Date(2026, 2, 3)).due]);
  logBw(G, at(2026, 3, 3, 7), 82);
  assert.equal(JSON.stringify([nextSessionIndex(G, s), schedule(G, s, new Date(2026, 2, 3)).due]), before);
});

// ---- 4. base XP ------------------------------------------------------------------------------

test('4. XP base values, home diminishing returns, bodyweight once per 7 days, already-logged workouts count', () => {
  const s = withPullups(5);
  const W = [];
  // Workouts logged "before v5" (nothing about XP stored on them).
  logGym(W, s, at(2026, 3, 2));
  logHome(W, at(2026, 3, 3, 8), [newItem('swings', W)]);
  logBw(W, at(2026, 3, 3, 7), 82.4);
  logBw(W, at(2026, 3, 6, 7), 82.2); // within 7 days: logged, no XP
  logBw(W, at(2026, 3, 10, 7), 82.0); // 7 days after the rewarded one
  const L = xpLedger(W, s);
  const byKind = (k) => L.entries.filter((e) => e.kind === k).map((e) => e.base);
  assert.deepEqual(byKind('gym'), [4000]);
  assert.deepEqual(byKind('home'), [1200]);
  assert.deepEqual(byKind('bw'), [400, 0, 400]);
  assert.equal(XP.gymTest, 6000);
  assert.equal(XP.pullupTest, 6000);

  // A 3–5 block session with a 1RM test is worth 6,000; a pull-up max test 6,000.
  const t = startBlock(switchBlockNow(s), W, { kind: '3-5', oneRM: { squat: 140, bench: 105, deadlift: 180, ohp: 70 }, startPct: 0.65, stepPct: 0.025 });
  const T = [];
  for (let i = 0; i < 8; i++) {
    const w = workoutFromPlan(planSession(nextSessionIndex(T, t), T, t));
    for (const e of w.lifts) {
      if (e.type === 'test') e.attempts = [];
      else e.groups.forEach((g) => g.sets.forEach((x) => (x.done = true)));
      if (e.type === '3x5') e.tough = true;
    }
    w.date = at(2026, 4, 1 + i * 2);
    w.createdAt = Date.parse(w.date);
    T.push(w);
  }
  const tl = xpLedger(T, t).entries.filter((e) => e.kind === 'gym');
  assert.deepEqual(tl.map((e) => e.base), [4000, 4000, 4000, 4000, 4000, 4000, 6000, 6000]);
  assert.deepEqual(tl[7].milestones, [{ label: 'Completed 3–5 block', xp: 20000 }]); // all four tested

  const P = withPullups(5);
  const PW = [];
  for (let i = 0; i < 25; i++) logHome(PW, at(2026, 5, 1 + i), [ladderItem(PW, P, at(2026, 5, 1 + i))]);
  const pl = xpLedger(PW, P).entries.filter((e) => e.kind === 'pullups');
  assert.equal(pl.length, 25);
  assert.deepEqual(pl[24].milestones, [{ label: 'Completed pull-up program (25 ladders)', xp: 12000 }]);
  const test = { move: 'pullups', ...newPullupRecord(pullupState(PW, P, new Date(2026, 5, 3))) };
  test.sets[0].done = true;
  logHome(PW, at(2026, 6, 3), [test]);
  assert.equal(xpLedger(PW, P).entries.filter((e) => e.label === 'Pull-up max test')[0].total, 6000);
});

// ---- 5. on-time streak --------------------------------------------------------------------------

test('5. on-time streak: +5% each up to +50%; 1 day late half, kept; 2+ late reset; rest day paused', () => {
  const s = defaultSettings();
  const W = [];
  const dates = [
    at(2026, 1, 1), // first ever: streak 1, +5%
    at(2026, 1, 3), // on time: streak 2, +10%
    at(2026, 1, 5), // on time: streak 3, +15%
    at(2026, 1, 8), // due 7th, 1 day late: half of 15%, streak kept 3
    at(2026, 1, 10), // due 10th: on time, streak 4
    at(2026, 1, 11), // before due (rest day): no bonus, paused at 4
    at(2026, 1, 13), // due 13th: on time, streak 5
    at(2026, 1, 18), // due 15th, 3 days late: reset
    at(2026, 1, 20), // on time: streak 1
  ];
  for (const d of dates) logGym(W, s, d);
  const g = gymEntries(W, s);
  assert.deepEqual(
    g.map((e) => [e.bonus, e.streak]),
    [
      [200, 1],
      [400, 2],
      [600, 3],
      [300, 3],
      [800, 4],
      [0, 4],
      [1000, 5],
      [0, 0],
      [200, 1],
    ]
  );
  assert.equal(breakdown(g[2]), '4,000 + 600 on-time bonus (streak 3)');
  assert.deepEqual(g[5].milestones, [{ label: 'Completed 6-session cycle', xp: 4000 }]); // 6th gym session

  // Cap at +50% (10 on time in a row); the streak keeps counting.
  const C = [];
  for (let i = 0; i < 12; i++) logGym(C, s, at(2026, 2, 1 + i * 2));
  const c = gymEntries(C, s);
  assert.equal(c[9].bonus, 2000);
  assert.equal(c[11].bonus, 2000);
  assert.equal(c[11].streak, 12);
  assert.equal(xpLedger(C, s).bonusPct, 0.5);
  // Earned XP is never taken away: a late session only loses the future bonus.
  const before = xpLedger(C, s).entries.slice(0, 12).map((e) => e.total);
  logGym(C, s, at(2026, 3, 20));
  assert.deepEqual(xpLedger(C, s).entries.slice(0, 12).map((e) => e.total), before);
});

// ---- 6. edit / delete recalculates ------------------------------------------------------------

test('6. editing or deleting a workout recalculates XP, level, belt and streak', () => {
  const s = defaultSettings();
  const W = [];
  for (let i = 0; i < 4; i++) logGym(W, s, at(2026, 1, 1 + i * 2));
  const full = xpLedger(W, s);
  assert.equal(full.streak, 4);
  // Move the 3rd session 3 days later → it's late, the streak resets.
  W[2].date = at(2026, 1, 8);
  W[3].date = at(2026, 1, 10);
  const edited = xpLedger(W, s);
  assert.equal(edited.streak, 1);
  assert.ok(edited.total < full.total);
  // Delete one → its XP is gone.
  W.splice(1, 1);
  const del = xpLedger(W, s);
  assert.equal(del.entries.length, 3);
  assert.equal(levelForXp(del.total), levelInfo(del.total).level);
  assert.equal(beltInfo(del.total).belt.id, 'white');
});

// ---- 7. level curve -------------------------------------------------------------------------------

test('7. level curve = Old School RuneScape table', () => {
  assert.equal(LEVEL_XP[2], 83);
  assert.equal(LEVEL_XP[50], 101333);
  assert.equal(LEVEL_XP[81], 2192818);
  assert.equal(LEVEL_XP[83], 2673114);
  assert.equal(LEVEL_XP[92], 6517253);
  assert.equal(LEVEL_XP[99], 13034431);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(82), 1);
  assert.equal(levelForXp(83), 2);
  assert.equal(levelForXp(13034430), 98);
  assert.equal(levelForXp(13034431), 99);
  assert.equal(levelForXp(200000000), 99); // max 99, XP keeps counting
  assert.equal(levelInfo(100).toNext, LEVEL_XP[3] - 100);
});

// ---- 8. belts, stripes, degrees -----------------------------------------------------------------

test('8. belts and stripes at the right levels; black belt degrees every 4,000,000 XP after 99', () => {
  assert.equal(beltInfo(0).belt.name, 'White');
  assert.equal(beltInfo(0).stripes, 0);
  const whiteGap = LEVEL_XP[83];
  assert.equal(beltInfo(Math.ceil(whiteGap * 0.2)).stripes, 1);
  assert.equal(beltInfo(Math.floor(whiteGap * 0.2) - 1).stripes, 0);
  assert.equal(beltInfo(Math.ceil(whiteGap * 0.8)).stripes, 4);
  assert.equal(beltInfo(LEVEL_XP[83] - 1).belt.name, 'White');
  assert.equal(beltInfo(LEVEL_XP[83]).belt.name, 'Blue');
  assert.equal(beltInfo(LEVEL_XP[83]).stripes, 0);
  assert.equal(beltInfo(LEVEL_XP[91]).belt.name, 'Purple');
  assert.equal(beltInfo(LEVEL_XP[95]).belt.name, 'Brown');
  assert.equal(beltInfo(LEVEL_XP[98]).belt.name, 'Black');
  assert.equal(beltInfo(LEVEL_XP[98]).badge99, false);
  const at99 = beltInfo(LEVEL_XP[99]);
  assert.equal(at99.badge99, true);
  assert.equal(at99.degrees, 0);
  assert.equal(at99.toNextDegree, 4000000);
  assert.equal(beltInfo(LEVEL_XP[99] + 4000000).degrees, 1);
  assert.equal(beltInfo(LEVEL_XP[99] + 7999999).degrees, 1);
  assert.equal(beltInfo(LEVEL_XP[99] + 24000000).degrees, 6);
  assert.equal(beltInfo(LEVEL_XP[99] + 90000000).degrees, 6); // max 6
  assert.equal(beltInfo(1000).toNextStripe, Math.ceil(whiteGap / 5) - 1000);
});

// ---- 9. game mode ------------------------------------------------------------------------------------

test('9. game mode is on by default, can be switched off, and older settings get it on', () => {
  assert.equal(defaultSettings().gameMode, true);
  assert.equal(mergeSettings({ restSeconds: 300 }).gameMode, true);
  assert.equal(mergeSettings({ ...defaultSettings(), gameMode: false }).gameMode, false);
});

// ---- 10. upgrade from v4 -----------------------------------------------------------------------------

test('10. upgrade from v4 keeps every workout, home session, pull-up session and setting', () => {
  const s = withPullups(8);
  s.restSeconds = 240;
  s.lastExportAt = '2026-11-10T08:00:00.000Z';
  delete s.gameMode;
  delete s.name;
  const W = [];
  for (let i = 0; i < 7; i++) logGym(W, s, at(2026, 10, 1 + i * 2), i === 3 ? { pullups: { ...newPullupRecord(pullupState(W, s, new Date(2026, 9, 7))) } } : {});
  logHome(W, at(2026, 10, 2, 8), [newItem('warmup', W), newItem('swings', W), newItem('getups', W)]);
  logHome(W, at(2026, 10, 4, 8), [ladderItem(W, s, at(2026, 10, 4, 8)), newItem('press', W)]);
  W.push({ id: 'v3-kb', kind: 'home', date: at(2026, 9, 28), swings: { reps: 100, kg: 20 }, getups: { reps: 10, kg: 20 } });
  const v4backup = JSON.parse(JSON.stringify({ app: 'strength-log', version: 3, settings: s, workouts: W }));

  const back = readBackup(v4backup);
  assert.equal(back.workouts.length, W.length);
  assert.deepEqual(back.workouts, v4backup.workouts); // nothing rewritten
  assert.equal(back.settings.restSeconds, 240);
  assert.equal(back.settings.lastExportAt, s.lastExportAt);
  assert.deepEqual(back.settings.pullups, s.pullups);
  assert.equal(back.settings.gameMode, true);
  assert.ok(xpLedger(back.workouts, back.settings).total > 0); // old workouts earn XP

  // A v5 backup with bodyweight entries round-trips too.
  logBw(W, at(2026, 10, 20, 7), 82.4);
  const v5 = readBackup(JSON.parse(JSON.stringify(makeBackup(back.settings, W))));
  assert.equal(v5.workouts.filter((w) => w.kind === 'bw').length, 1);
  assert.equal(v5.workouts.length, W.length);
});
