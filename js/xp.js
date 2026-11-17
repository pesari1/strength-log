// Strength Log — game layer: XP, levels (Old School RuneScape curve), belts and stripes.
// Pure functions. Everything is calculated from the log every time — no stored totals —
// so editing or deleting a workout recalculates XP, level, belt and streak.
// Nothing here is read by the gym plan.

import * as L from './logic.js';
import { homeItems } from './home.js';
import { pullupRecords, pullupState } from './pullups.js';
import { bwEntries, BW_EVERY_DAYS } from './body.js';

export const XP = {
  gym: 4000, // any gym session (volume, heavy, unload, 3–5)
  gymTest: 6000, // gym session with a 1RM test (3–5 block)
  pullupTest: 6000, // pull-up max test
  home: [1200, 600], // 1st and 2nd home session of the day; 3rd and later: 0
  ladder: 800, // first pull-up ladder of the day (counted)
  bodyweight: 400, // max 1 per 7 days
  cycle: 4000, // every 6th gym session in a 5×5 block
  block: 20000, // block finished on its own
  pullupProgram: 12000, // 25 ladders done
};

export const STREAK_STEP = 0.05; // +5% per on-time session
export const STREAK_CAP = 10; // up to +50%

// ---------- levels: exact Old School RuneScape table ----------

/** LEVEL_XP[L] = XP needed for level L (1–99). */
export const LEVEL_XP = (() => {
  const t = [0, 0];
  let points = 0;
  for (let l = 1; l < 99; l++) {
    points += Math.floor(l + 300 * Math.pow(2, l / 7));
    t[l + 1] = Math.floor(points / 4);
  }
  return t;
})();
export const MAX_LEVEL = 99;

export function levelForXp(xp) {
  let lv = 1;
  while (lv < MAX_LEVEL && xp >= LEVEL_XP[lv + 1]) lv++;
  return lv;
}

export function levelInfo(xp) {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, xp, from: LEVEL_XP[99], to: null, toNext: 0, pct: 1 };
  const from = LEVEL_XP[level];
  const to = LEVEL_XP[level + 1];
  return { level, xp, from, to, toNext: to - xp, pct: (xp - from) / (to - from) };
}

// ---------- belts and stripes ----------

export const BELTS = [
  { id: 'white', name: 'White', from: 1 },
  { id: 'blue', name: 'Blue', from: 83 },
  { id: 'purple', name: 'Purple', from: 91 },
  { id: 'brown', name: 'Brown', from: 95 },
  { id: 'black', name: 'Black', from: 98 },
];
export const DEGREE_XP = 4000000; // black belt degree per 4,000,000 XP past level 99
export const MAX_DEGREES = 6;

export function beltInfo(xp) {
  const level = levelForXp(xp);
  let i = 0;
  BELTS.forEach((b, j) => {
    if (level >= b.from) i = j;
  });
  const belt = BELTS[i];
  const start = LEVEL_XP[belt.from];
  const end = i + 1 < BELTS.length ? LEVEL_XP[BELTS[i + 1].from] : LEVEL_XP[99];
  const gap = end - start;
  const stripes = Math.min(4, Math.max(0, Math.floor(((xp - start) / gap) * 5 + 1e-9)));
  const nextStripeAt = stripes < 4 ? start + Math.ceil((gap * (stripes + 1)) / 5) : null;
  const out = {
    belt,
    level,
    stripes,
    start,
    end,
    toNextStripe: nextStripeAt != null ? Math.max(0, nextStripeAt - xp) : null,
    toNextBelt: xp < end ? end - xp : 0,
    nextBelt: i + 1 < BELTS.length ? BELTS[i + 1] : null,
    degrees: 0,
    toNextDegree: null,
    badge99: level >= MAX_LEVEL,
  };
  if (level >= MAX_LEVEL) {
    out.stripes = 4;
    out.toNextStripe = null;
    out.toNextBelt = 0;
    out.degrees = Math.min(MAX_DEGREES, Math.floor((xp - LEVEL_XP[99]) / DEGREE_XP));
    out.toNextDegree = out.degrees < MAX_DEGREES ? LEVEL_XP[99] + (out.degrees + 1) * DEGREE_XP - xp : null;
  }
  return out;
}

// ---------- the XP ledger ----------

function sum(list) {
  return list.reduce((s, m) => s + m.xp, 0);
}

/** Milestones earned by gym workouts: Map workoutId → [{ label, xp }]. */
function gymMilestones(workouts, settings) {
  const out = new Map();
  const add = (id, label, xp) => {
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ label, xp });
  };
  for (const block of L.blocksOf(settings)) {
    const ws = L.blockWorkouts(workouts, settings, block.id);
    if (block.kind === '5x5') {
      ws.forEach((w, i) => {
        if ((i + 1) % 6 === 0) add(w.id, 'Completed 6-session cycle', XP.cycle);
      });
      const len = block.length || settings.block5x5Length || 24;
      if (ws.length >= len) add(ws[len - 1].id, 'Completed 5×5 block', XP.block);
    } else if (block.kind === '3-5') {
      for (let k = 1; k <= ws.length; k++) {
        const st = L.computeTfStates(ws.slice(0, k), settings, block);
        if (L.LIFTS.every((l) => st[l.id].tested)) {
          add(ws[k - 1].id, 'Completed 3–5 block', XP.block);
          break;
        }
      }
    }
  }
  return out;
}

/** Every XP entry from the log, oldest first, plus totals and the current on-time streak.
 *  Entry: { key, refId, date, kind, label, base, bonus, streak, timing, milestones, total } */
export function xpLedger(workouts, settings) {
  const entries = [];
  const ws = (workouts || []).filter(Boolean);

  // Gym sessions, with the on-time streak bonus.
  const milestones = gymMilestones(ws, settings);
  let streak = 0;
  let prev = null;
  for (const w of L.sortByDate(ws.filter((x) => x.kind === 'gym'))) {
    const base = (w.lifts || []).some((e) => e.type === 'test') ? XP.gymTest : XP.gym;
    let pct = 0;
    let timing;
    if (!prev) {
      streak += 1;
      pct = Math.min(streak, STREAK_CAP) * STREAK_STEP;
      timing = 'first session';
    } else {
      const due = L.addDays(prev.date, L.REST_DAYS + 1);
      const late = L.daysBetween(due, w.date);
      if (late === 0) {
        streak += 1;
        pct = Math.min(streak, STREAK_CAP) * STREAK_STEP;
        timing = 'on time';
      } else if (late === 1) {
        pct = (Math.min(streak, STREAK_CAP) * STREAK_STEP) / 2;
        timing = '1 day late — half bonus, streak kept';
      } else if (late >= 2) {
        streak = 0;
        timing = `${late} days late — streak reset`;
      } else {
        timing = 'trained on a rest day — no bonus, streak paused';
      }
    }
    const bonus = Math.round(base * pct);
    const ms = milestones.get(w.id) || [];
    entries.push({
      key: 'gym:' + w.id,
      refId: w.id,
      date: w.date,
      kind: 'gym',
      label: L.workoutTitle(w),
      base,
      bonus,
      bonusPct: pct,
      streak,
      timing,
      milestones: ms,
      total: base + bonus + sum(ms),
    });
    prev = w;
  }

  // Home sessions: 1st of the day 1,200, 2nd 600, 3rd and later 0.
  const perDay = new Map();
  for (const w of L.sortByDate(ws.filter((x) => x.kind === 'home'))) {
    const k = L.localDay(w.date).getTime();
    const n = (perDay.get(k) || 0) + 1;
    perDay.set(k, n);
    const base = XP.home[n - 1] || 0;
    entries.push({
      key: 'home:' + w.id,
      refId: w.id,
      date: w.date,
      kind: 'home',
      label: 'Home session',
      base,
      bonus: 0,
      timing: n === 1 ? '1st home session today' : n === 2 ? '2nd home session today' : `${n}th home session today — logged, no XP`,
      milestones: [],
      total: base,
    });
  }

  // Pull-ups: the first pull-up session of each day counts.
  const ps = pullupState(ws, settings);
  const done = new Set((ps.completions || []).map((c) => c.id + '|' + c.date));
  for (const r of pullupRecords(ws)) {
    if (!r.counts) continue;
    if (r.rec.mode === 'ladder') {
      const ms = done.has(r.id + '|' + r.date) ? [{ label: 'Completed pull-up program (25 ladders)', xp: XP.pullupProgram }] : [];
      entries.push({ key: 'pu:' + r.id, refId: r.id, date: r.date, kind: 'pullups', label: 'Pull-up ladder', base: XP.ladder, bonus: 0, milestones: ms, total: XP.ladder + sum(ms) });
    } else if (r.rec.mode === 'test') {
      entries.push({ key: 'pu:' + r.id, refId: r.id, date: r.date, kind: 'pullups', label: 'Pull-up max test', base: XP.pullupTest, bonus: 0, milestones: [], total: XP.pullupTest });
    }
  }

  // Bodyweight: 400 XP, at most once per 7 days.
  let rewarded = null;
  for (const b of bwEntries(ws)) {
    const ok = !rewarded || L.daysBetween(rewarded.date, b.date) >= BW_EVERY_DAYS;
    if (ok) rewarded = b;
    entries.push({
      key: 'bw:' + b.id,
      refId: b.id,
      date: b.date,
      kind: 'bw',
      label: 'Bodyweight entry',
      base: ok ? XP.bodyweight : 0,
      bonus: 0,
      timing: ok ? '' : 'already logged within 7 days — no XP',
      milestones: [],
      total: ok ? XP.bodyweight : 0,
    });
  }

  entries.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.key.localeCompare(b.key));
  const total = entries.reduce((s, e) => s + e.total, 0);
  return { entries, total, streak, bonusPct: Math.min(streak, STREAK_CAP) * STREAK_STEP };
}

/** XP entries for one workout (a gym workout can also hold that day's pull-ups). */
export function xpFor(ledger, refId) {
  return ledger.entries.filter((e) => e.refId === refId);
}

/** "4,000 + 1,200 on-time bonus (streak 6)" */
export function breakdown(e, fmt = (n) => n.toLocaleString('en-US')) {
  let s = fmt(e.base);
  if (e.bonus) s += ` + ${fmt(e.bonus)} on-time bonus (streak ${e.streak})`;
  for (const m of e.milestones) s += ` + ${fmt(m.xp)} ${m.label.toLowerCase()}`;
  return s;
}
