// Strength Log — achievements, records and "then vs now" (v6).
// Pure functions. Everything is worked out from the log every time — nothing is stored —
// so editing or deleting a workout recalculates every achievement, record and progress bar.
// Nothing here is read by the gym plan.
//
// An achievement definition: { id, cat, tier, name, desc, hidden?, eval(F) }.
// eval gets the "facts" worked out once from the log and returns
//   { earned: { date, refId } | null, pct: 0–1, text: '90 / 140 kg', note? }
// refId is the logged entry (workout, home session, bodyweight entry) that earned it.

import * as L from './logic.js';
import { homeItems, itemTotal } from './home.js';
import { pullupRecords, pullupState } from './pullups.js';
import { bwEntries } from './body.js';

export const TIERS = [
  { id: 'bronze', name: 'Bronze', xp: 1000 },
  { id: 'silver', name: 'Silver', xp: 2500 },
  { id: 'gold', name: 'Gold', xp: 5000 },
  { id: 'platinum', name: 'Platinum', xp: 10000 },
  { id: 'legendary', name: 'Legendary', xp: 20000 },
];
export const TIER = Object.fromEntries(TIERS.map((t, i) => [t.id, { ...t, rank: i + 1 }]));
const ORDER = TIERS.map((t) => t.id);

export const CATEGORIES = [
  { id: 'ratio', name: 'Bodyweight ratios' },
  { id: 'plates', name: 'Plate clubs' },
  { id: 'total', name: 'Total clubs' },
  { id: 'program', name: 'Program milestones' },
  { id: 'consistency', name: 'Consistency' },
  { id: 'discipline', name: 'Pavel discipline' },
  { id: 'pullups', name: 'Pull-ups' },
  { id: 'kettlebell', name: 'Kettlebell' },
  { id: 'skills', name: 'Bodyweight skills' },
  { id: 'endurance', name: 'Endurance' },
  { id: 'tonnage', name: 'Tonnage' },
  { id: 'habits', name: 'Habits' },
  { id: 'hidden', name: 'Hidden' },
];

export const RECORD_REPS = [1, 3, 5];
export const COMEBACK_DAYS = 14;

// ---------- small helpers ----------

const EPS = 1e-9;
const ts = (d) => {
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};
const at = (w) => ({ date: w.date, refId: w.id });
const n0 = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const int = (x) => Math.round(x).toLocaleString('en-US');
const kg = (x) => L.fmtKg(x);
const r2 = (x) => {
  const c = Math.round(x * 100);
  return (c / 100).toFixed(c % 10 ? 2 : 1); // 1.0, 1.5, 1.75
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const earliest = (list) => list.filter(Boolean).sort((a, b) => ts(a.date) - ts(b.date))[0] || null;

/** First point of a running (never-decreasing) series that reaches the target. */
function firstReach(series, target) {
  const hit = series.find((p) => p.value >= target - EPS);
  return hit ? { date: hit.date, refId: hit.refId } : null;
}
const lastVal = (series) => (series.length ? series[series.length - 1].value : 0);

/** A running series over time: { date, refId, value } with value never going down. */
function runningMax(points) {
  let m = 0;
  return points.map((p) => ((m = Math.max(m, p.value)), { ...p, value: m }));
}
function runningSum(points) {
  let s = 0;
  return points.map((p) => ((s += p.value), { ...p, value: s }));
}

function result(earned, cur, target, show = (v) => int(v), note) {
  const pct = earned ? 1 : Math.max(0, Math.min(0.99, target > 0 ? cur / target : 0));
  return { earned, pct, text: `${show(Math.min(cur, target))} / ${show(target)}`, note };
}

/** Threshold achievement on a running series. */
function reach(series, target, show, note) {
  return result(firstReach(series, target), lastVal(series), target, show, note);
}

// ---------- reading the log ----------

/** Done sets with 1+ reps and clean 1RM attempts: [{ weight, reps }]. Exact logged weights. */
export function cleanSets(entry) {
  const out = [];
  for (const g of entry.groups || [])
    for (const s of g.sets || []) if (s.done && (s.reps | 0) >= 1 && n0(g.weight) > 0) out.push({ weight: n0(g.weight), reps: s.reps | 0 });
  for (const a of entry.attempts || [])
    if (a && a.clean !== false && (a.reps | 0) >= 1 && n0(a.weight) > 0) out.push({ weight: n0(a.weight), reps: a.reps | 0 });
  return out;
}

/** Bodyweight entry closest to a date (ties → the earlier one), or null. */
export function bwAt(entries, date) {
  let best = null;
  const t = ts(date);
  for (const b of entries) {
    if (!(n0(b.kg) > 0)) continue;
    if (!best || Math.abs(ts(b.date) - t) < Math.abs(ts(best.date) - t)) best = b;
  }
  return best ? n0(best.kg) : null;
}

/** On-time timeline of gym sessions (same rules as the XP on-time bonus).
 *  [{ w, late, onTime, early, streak, pct, timing }]; late = days after the due date (null for the first). */
export function gymTimeline(workouts, step = 0.05, cap = 10) {
  const out = [];
  let streak = 0;
  let prev = null;
  for (const w of L.sortByDate((workouts || []).filter((x) => x && x.kind === 'gym'))) {
    let pct = 0;
    let timing;
    let late = null;
    if (!prev) {
      streak += 1;
      pct = Math.min(streak, cap) * step;
      timing = 'first session';
    } else {
      late = L.daysBetween(L.addDays(prev.date, L.REST_DAYS + 1), w.date);
      if (late === 0) {
        streak += 1;
        pct = Math.min(streak, cap) * step;
        timing = 'on time';
      } else if (late === 1) {
        pct = (Math.min(streak, cap) * step) / 2;
        timing = '1 day late — half bonus, streak kept';
      } else if (late >= 2) {
        streak = 0;
        timing = `${late} days late — streak reset`;
      } else {
        timing = 'trained on a rest day — no bonus, streak paused';
      }
    }
    out.push({ w, late, onTime: late === null || late === 0, early: late !== null && late < 0, streak, pct, timing });
    prev = w;
  }
  return out;
}

/** Every block with its workouts, whether it finished on its own, and its 6-session cycles (5×5). */
export function blockRuns(workouts, settings) {
  return L.blocksOf(settings).map((block) => {
    const ws = L.blockWorkouts(workouts, settings, block.id);
    if (block.kind === '3-5') {
      const tested = new Set();
      let done = null;
      let used = ws;
      for (let k = 0; k < ws.length && !done; k++) {
        for (const e of ws[k].lifts || []) if (e.type === 'test') tested.add(e.lift);
        if (L.LIFTS.every((l) => tested.has(l.id))) {
          done = ws[k];
          used = ws.slice(0, k + 1);
        }
      }
      return { block, ws, used, done, progress: tested.size, length: L.LIFTS.length, cycles: [] };
    }
    const length = block.length || settings.block5x5Length || 24;
    const done = ws.length >= length ? ws[length - 1] : null;
    const cycles = [];
    for (let i = 0; i < ws.length; i += 6) cycles.push(ws.slice(i, i + 6));
    return { block, ws, used: done ? ws.slice(0, length) : ws, done, progress: Math.min(ws.length, length), length, cycles };
  });
}

function pullupSets(workouts) {
  const out = [];
  for (const w of workouts) {
    const recs = [];
    if (w.kind === 'gym' && w.pullups && Array.isArray(w.pullups.sets)) recs.push(w.pullups);
    if (w.kind === 'home') for (const it of homeItems(w)) if (it.move === 'pullups' && Array.isArray(it.sets)) recs.push(it);
    for (const rec of recs)
      for (const s of rec.sets) if (s && s.done && (s.reps | 0) >= 1) out.push({ ...at(w), kg: n0(rec.kg), reps: s.reps | 0 });
  }
  return L.sortByDate(out);
}

function weekStart(d) {
  const x = L.localDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

/** Best capped "5 ladders of 1-2-3-4-5" reps in one press session (max 75 per arm). */
function ladderGoalReps(ladders) {
  const tops = (ladders || []).map((l) => Math.min(5, l.top | 0)).sort((a, b) => b - a).slice(0, 5);
  return tops.reduce((s, t) => s + (t * (t + 1)) / 2, 0);
}

export function fmtDuration(sec) {
  if (!(sec > 0)) return '';
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

// ---------- the facts, worked out once per call ----------

function buildFacts(workouts, settings, now) {
  const ws = (workouts || []).filter(Boolean);
  const gym = L.sortByDate(ws.filter((w) => w.kind === 'gym'));
  const home = L.sortByDate(ws.filter((w) => w.kind === 'home'));
  const bws = bwEntries(ws);
  const timeline = gymTimeline(gym);
  const F = { settings, now, ws, gym, home, bws, timeline, blocks: blockRuns(ws, settings) };

  // Per-lift running best weight, best bodyweight ratio, and the total.
  F.best = {};
  F.ratio = {};
  F.total = [];
  const top = {};
  const topR = {};
  for (const l of L.LIFTS) {
    F.best[l.id] = [];
    F.ratio[l.id] = [];
    top[l.id] = 0;
    topR[l.id] = 0;
  }
  F.tonnage = [];
  F.runKm = [];
  for (const w of gym) {
    let touched = false;
    let tons = 0;
    for (const e of w.lifts || []) {
      const sets = cleanSets(e);
      for (const s of sets) tons += s.weight * s.reps;
      if (!(e.lift in top) || !sets.length) continue;
      const best = Math.max(...sets.map((s) => s.weight));
      top[e.lift] = Math.max(top[e.lift], best);
      F.best[e.lift].push({ ...at(w), value: top[e.lift] });
      const bw = bwAt(bws, w.date);
      if (bw) {
        topR[e.lift] = Math.max(topR[e.lift], best / bw);
        F.ratio[e.lift].push({ ...at(w), value: topR[e.lift] });
      }
      touched = true;
    }
    for (const x of w.extras || []) for (const s of x.sets || []) if ((s.reps | 0) > 0 && n0(x.weight) > 0) tons += n0(x.weight) * (s.reps | 0);
    if (touched) F.total.push({ ...at(w), value: top.squat + top.bench + top.deadlift });
    if (tons > 0) F.tonnage.push({ ...at(w), value: tons });
    const c = w.cardio;
    if (c && c.type === 'run' && n0(c.distance) > 0) F.runKm.push({ ...at(w), value: c.unit === 'm' ? n0(c.distance) / 1000 : n0(c.distance) });
  }
  F.tonnage = runningSum(F.tonnage);
  F.runKm = runningSum(F.runKm);
  F.gymCount = gym.map((w, i) => ({ ...at(w), value: i + 1 }));
  F.streak = runningMax(timeline.map((t) => ({ ...at(t.w), value: t.streak })));
  F.latestBw = bws.length ? n0(bws[bws.length - 1].kg) : null;

  // Pull-ups.
  F.puSets = pullupSets(ws);
  F.puReps = runningMax(F.puSets.map((s) => ({ ...s, value: s.reps })));
  F.puKg = runningMax(F.puSets.filter((s) => s.kg > 0).map((s) => ({ ...s, value: s.kg })));

  // Home: kettlebell and bodyweight skills.
  const swings = [];
  const getups = [];
  F.press = []; // { date, refId, kg, ladders }
  F.timed = []; // per session: best timed swings bell, get-ups bell
  F.skill = { pistol: [], oap: [] }; // full (no variation) best set per session
  for (const w of home) {
    let sw = 0;
    let gu = 0;
    for (const it of homeItems(w)) {
      const bell = n0(it.kg);
      const dur = n0(it.durationSec);
      if (it.move === 'swings') {
        const reps = itemTotal(it);
        if (reps > 0) swings.push({ ...at(w), value: reps });
        if (reps >= 100 && dur > 0 && dur <= 300) sw = Math.max(sw, bell);
      } else if (it.move === 'getups') {
        const reps = itemTotal(it);
        if (reps > 0) getups.push({ ...at(w), value: reps });
        if (reps >= 10 && dur > 0 && dur <= 600) gu = Math.max(gu, bell);
      } else if (it.move === 'press' && Array.isArray(it.ladders) && it.ladders.length) {
        F.press.push({ ...at(w), kg: bell, ladders: it.ladders });
      } else if ((it.move === 'pistol' || it.move === 'oap') && !(it.variation || '').trim()) {
        const best = Math.max(0, ...(it.sets || []).map((s) => s.reps | 0));
        if (best > 0) F.skill[it.move].push({ ...at(w), value: best });
      }
    }
    F.timed.push({ ...at(w), sw, gu });
  }
  F.swings = runningSum(swings);
  F.getups = runningSum(getups);
  F.skill.pistol = runningMax(F.skill.pistol);
  F.skill.oap = runningMax(F.skill.oap);
  return F;
}

// ---------- the list ----------

const LIFT_SHORT = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift', ohp: 'Overhead press' };

function ratioDefs() {
  const T = {
    squat: [1.0, 1.5, 1.75, 2.0, 2.25],
    bench: [0.75, 1.0, 1.25, 1.5, 1.7],
    deadlift: [1.25, 1.75, 2.0, 2.5, 3.0],
    ohp: [0.5, 0.6, 0.75, 0.9, 1.1],
  };
  const out = [];
  for (const lift of Object.keys(T)) {
    T[lift].forEach((t, i) => {
      const nm = lift === 'ohp' ? 'Overhead press (strict)' : LIFT_SHORT[lift];
      out.push({
        id: `ratio-${lift}-${t}`,
        cat: 'ratio',
        tier: ORDER[i],
        name: `${nm} ${r2(t)}× bodyweight`,
        desc: `${L.LIFT_BY_ID[lift].name} with ${r2(t)} times your bodyweight (your bodyweight entry closest to the day of the lift).`,
        eval: (F) =>
          reach(
            F.ratio[lift],
            t,
            (v) => `${r2(v)}×`,
            F.latestBw ? `${kg(Math.round(t * F.latestBw * 10) / 10)} kg at your latest bodyweight (${kg(F.latestBw)} kg)` : 'Log your bodyweight to track this.'
          ),
      });
    });
  }
  return out;
}

function plateDefs() {
  const T = {
    squat: [[2, 100, 'bronze'], [3, 140, 'gold'], [4, 180, 'legendary']],
    bench: [[2, 100, 'silver'], [3, 140, 'legendary']],
    deadlift: [[3, 140, 'bronze'], [4, 180, 'gold'], [5, 220, 'platinum'], [6, 260, 'legendary']],
    ohp: [[1, 60, 'bronze']],
  };
  const out = [];
  for (const lift of Object.keys(T)) {
    for (const [plates, w, tier] of T[lift]) {
      out.push({
        id: `plates-${lift}-${w}`,
        cat: 'plates',
        tier,
        name: `${LIFT_SHORT[lift]} ${plural(plates, 'plate')} (${w} kg)`,
        desc: `${plural(plates, '20 kg plate')} per side on a 20 kg bar${lift === 'ohp' ? ', strict' : ''}.`,
        eval: (F) => reach(F.best[lift], w, (v) => `${kg(v)}`, 'kg'),
      });
    }
  }
  return out;
}

function totalDefs() {
  return [300, 400, 500, 600, 700].map((t, i) => ({
    id: `total-${t}`,
    cat: 'total',
    tier: ORDER[i],
    name: `${t} kg total`,
    desc: 'Best squat + best bench + best deadlift (any number of clean reps).',
    eval: (F) => reach(F.total, t, (v) => kg(v), 'kg'),
  }));
}

function programDefs() {
  const out = [];
  out.push({
    id: 'first-cycle',
    cat: 'program',
    tier: 'bronze',
    name: 'First full cycle',
    desc: 'All 6 sessions of a cycle in a 5×5 block.',
    eval: (F) => {
      const runs = F.blocks.filter((b) => b.block.kind === '5x5');
      const earned = earliest(runs.map((b) => b.ws[5] && at(b.ws[5])));
      const cur = Math.max(0, ...runs.map((b) => b.ws.length));
      return result(earned, cur, 6, (v) => String(v), 'sessions');
    },
  });
  out.push({
    id: 'first-5x5',
    cat: 'program',
    tier: 'silver',
    name: 'First 5×5 block',
    desc: 'A 5×5 block finished (not switched early).',
    eval: (F) => {
      const runs = F.blocks.filter((b) => b.block.kind === '5x5');
      const earned = earliest(runs.map((b) => b.done && at(b.done)));
      const best = runs.reduce((m, b) => (!m || b.progress / b.length > m.progress / m.length ? b : m), null);
      return result(earned, best ? best.progress : 0, best ? best.length : F.settings.block5x5Length || 24, (v) => String(v), 'sessions');
    },
  });
  out.push({
    id: 'first-3-5',
    cat: 'program',
    tier: 'silver',
    name: 'First 3–5 block',
    desc: 'A 3–5 block finished: all four lifts tested.',
    eval: (F) => {
      const runs = F.blocks.filter((b) => b.block.kind === '3-5');
      const earned = earliest(runs.map((b) => b.done && at(b.done)));
      return result(earned, Math.max(0, ...runs.map((b) => b.progress)), 4, (v) => String(v), 'lifts tested');
    },
  });
  for (const l of L.LIFTS) {
    out.push({
      id: `rm-record-${l.id}`,
      cat: 'program',
      tier: 'bronze',
      name: `New 1RM: ${LIFT_SHORT[l.id]}`,
      desc: `A 1RM test in the 3–5 block beats the ${l.name.toLowerCase()} 1RM you went in with.`,
      eval: (F) => {
        let earned = null;
        for (const b of F.blocks.filter((x) => x.block.kind === '3-5')) {
          let rm = n0((b.block.oneRM || {})[l.id]);
          for (const w of b.ws) {
            for (const e of w.lifts || []) {
              if (e.lift !== l.id || e.type !== 'test') continue;
              const best = L.bestCleanSingle(e.attempts);
              if (best != null && best > rm + EPS) earned = earliest([earned, at(w)]);
              if (best != null) rm = best;
            }
          }
        }
        return { ...result(earned, 0, 1), text: 'No new 1RM in a test yet' };
      },
    });
  }
  out.push({
    id: 'perfect-cycle',
    cat: 'program',
    tier: 'silver',
    name: 'Perfect cycle',
    desc: 'All 6 sessions of a 5×5 cycle on their due date.',
    eval: (F) => {
      const byId = new Map(F.timeline.map((t) => [t.w.id, t]));
      let earned = null;
      let cur = 0;
      for (const b of F.blocks) {
        for (const c of b.cycles) {
          let run = 0;
          while (run < c.length && byId.get(c[run].id).onTime) run++;
          if (c.length === 6 && run === 6) earned = earliest([earned, at(c[5])]);
          cur = Math.max(cur, run);
        }
      }
      return result(earned, cur, 6, (v) => String(v), 'on the due date, in one cycle');
    },
  });
  return out;
}

function consistencyDefs() {
  const out = [];
  [10, 50, 100, 250, 500].forEach((n, i) =>
    out.push({
      id: `sessions-${n}`,
      cat: 'consistency',
      tier: ORDER[i],
      name: `${n} gym sessions`,
      desc: `Log ${n} gym sessions.`,
      eval: (F) => reach(F.gymCount, n, (v) => String(v), 'sessions'),
    })
  );
  [6, 12, 24, 48].forEach((n, i) =>
    out.push({
      id: `streak-${n}`,
      cat: 'consistency',
      tier: ORDER[i],
      name: `On-time streak ${n}`,
      desc: `${n} gym sessions in a row on their due date.`,
      eval: (F) => reach(F.streak, n, (v) => String(v), 'best streak'),
    })
  );
  out.push({
    id: 'no-winter-break',
    cat: 'consistency',
    tier: 'gold',
    name: 'No Winter Break',
    desc: '8 or more gym sessions in every month from November to February, in one winter.',
    eval: (F) => {
      const months = new Map();
      for (const w of F.gym) {
        const d = new Date(w.date);
        const k = d.getFullYear() * 12 + d.getMonth();
        if (!months.has(k)) months.set(k, []);
        months.get(k).push(w);
      }
      let earned = null;
      let cur = 0;
      const years = F.gym.map((w) => new Date(w.date).getFullYear());
      for (let y = Math.min(...years, 9999) - 1; y <= Math.max(...years, 0); y++) {
        const keys = [y * 12 + 10, y * 12 + 11, (y + 1) * 12, (y + 1) * 12 + 1];
        const eighth = keys.map((k) => (months.get(k) || [])[7] || null);
        const ok = eighth.filter(Boolean);
        cur = Math.max(cur, ok.length);
        if (ok.length === 4) earned = earliest([earned, at(ok.sort((a, b) => ts(b.date) - ts(a.date))[0])]);
      }
      return result(earned, cur, 4, (v) => String(v), 'months with 8+ sessions in one winter');
    },
  });
  out.push({
    id: 'year-of-iron',
    cat: 'consistency',
    tier: 'legendary',
    name: 'Year of Iron',
    desc: '150 gym sessions within 12 months.',
    eval: (F) => {
      let earned = null;
      let cur = 0;
      let j = 0;
      for (let i = 0; i < F.gym.length; i++) {
        const from = L.localDay(F.gym[i].date);
        from.setFullYear(from.getFullYear() - 1);
        while (L.localDay(F.gym[j].date) <= from) j++;
        const n = i - j + 1;
        cur = Math.max(cur, n);
        if (n >= 150 && !earned) earned = at(F.gym[i]);
      }
      return result(earned, cur, 150, (v) => String(v), 'sessions in your best 12 months');
    },
  });
  return out;
}

function cleanWorkout(w) {
  return (w.lifts || []).every((e) => (e.groups || []).every((g) => (g.sets || []).every((s) => s.done && (s.reps | 0) >= (g.target | 0))));
}

/** "A whole block where every session passes the check": earned on a finished block; progress = current block. */
function wholeBlock(F, ok, what) {
  let earned = null;
  for (const b of F.blocks) if (b.done && b.used.every(ok)) earned = earliest([earned, at(b.done)]);
  const cur = F.blocks[F.blocks.length - 1];
  if (earned || !cur) return result(earned, 0, 1);
  const clean = cur.used.every(ok);
  const unit = cur.block.kind === '3-5' ? 'lifts tested' : 'sessions';
  if (!clean) return { ...result(null, 0, cur.length), text: 'Not in this block', note: 'Your next block is a fresh chance.' };
  return result(null, cur.progress, cur.length, (v) => String(v), `${unit} in this block, ${what} so far`);
}

function disciplineDefs() {
  return [
    {
      id: 'clean-block',
      cat: 'discipline',
      tier: 'gold',
      name: 'Clean Block',
      desc: 'A whole block with no missed reps (every set ticked with all its reps).',
      eval: (F) => wholeBlock(F, cleanWorkout, 'no missed reps'),
    },
    {
      id: 'iron-patience',
      cat: 'discipline',
      tier: 'silver',
      name: 'Iron Patience',
      desc: 'Miss reps at the same weight 3 sessions in a row (same lift, same kind of day), then get all reps at that weight or heavier.',
      eval: (F) => {
        const runs = new Map();
        let earned = null;
        for (const w of F.gym) {
          for (const e of w.lifts || []) {
            if (e.type === 'test') continue;
            const g = (e.groups || []).find((x) => x.role === 'work' || x.role === 'top') || (e.groups || [])[0];
            if (!g || !(g.sets || []).some((s) => s.done)) continue; // lift skipped that day
            const key = e.lift + '|' + L.normType(e.type);
            const st = runs.get(key) || { w: null, n: 0 };
            const weight = n0(g.weight);
            const full = g.sets.every((s) => s.done && (s.reps | 0) >= (g.target | 0));
            if (!full) {
              if (st.w === weight) st.n += 1;
              else Object.assign(st, { w: weight, n: 1 });
            } else {
              if (st.n >= 3 && weight >= st.w - EPS && !earned) earned = at(w);
              Object.assign(st, { w: null, n: 0 });
            }
            runs.set(key, st);
          }
        }
        const cur = Math.min(3, Math.max(0, ...[...runs.values()].map((r) => r.n)));
        const r = result(earned, cur, 4, (v) => String(v));
        if (!earned) {
          r.text = cur >= 3 ? '3 misses at one weight — now get all reps at it' : `${cur} of 3 misses at one weight, then all reps`;
        }
        return r;
      },
    },
    {
      id: 'rest-is-training',
      cat: 'discipline',
      tier: 'gold',
      name: 'Rest Is Training',
      desc: 'A whole block without training on a rest day (no rest-day warning ignored).',
      eval: (F) => {
        const early = new Set(F.timeline.filter((t) => t.early).map((t) => t.w.id));
        return wholeBlock(F, (w) => !early.has(w.id), 'no rest day trained');
      },
    },
  ];
}

function pullupDefs() {
  const out = [];
  out.push({
    id: 'pu-program',
    cat: 'pullups',
    tier: 'silver',
    name: 'Fighter Pullup Program',
    desc: 'Finish the pull-up program: 25 ladders, then a max test.',
    eval: (F) => {
      const ps = pullupState(F.ws, F.settings, F.now);
      if (ps.phase === 'setup') return { ...result(null, 0, 26), text: '0 of 25 ladders', note: 'Set up the pull-up program in Settings.' };
      const recs = pullupRecords(F.ws);
      let earned = null;
      for (const c of ps.completions || []) {
        const t = recs.find((r) => r.counts && r.rec.mode === 'test' && ts(r.date) > ts(c.date));
        if (t) earned = earliest([earned, { date: t.date, refId: t.id }]);
      }
      const cur = earned ? 26 : ps.phase === 'test' ? 25 : ps.done || 0;
      const r = result(earned, cur, 26);
      if (!earned) r.text = `${Math.min(cur, 25)} of 25 ladders${cur >= 25 ? ' — now the max test' : ', then a max test'}`;
      return r;
    },
  });
  out.push({
    id: 'pu-double',
    cat: 'pullups',
    tier: 'gold',
    name: 'Double your max',
    desc: 'Strict reps in one set: twice the max you started the pull-up program with.',
    eval: (F) => {
      const p = F.settings.pullups;
      if (!p) return { ...result(null, 0, 1), text: 'not started', note: 'Set up the pull-up program in Settings.' };
      const start = p.first || p;
      const target = Math.max(1, n0(start.max)) * 2;
      const since = ts(start.at);
      const series = runningMax(F.puSets.filter((s) => ts(s.date) >= since).map((s) => ({ ...s, value: s.reps })));
      return reach(series, target, (v) => String(v), `reps (started at ${n0(start.max)})`);
    },
  });
  [[10, 'bronze'], [15, 'silver'], [20, 'gold'], [25, 'legendary']].forEach(([n, tier]) =>
    out.push({
      id: `pu-reps-${n}`,
      cat: 'pullups',
      tier,
      name: `${n} strict pull-ups`,
      desc: `${n} strict pull-ups in one set.`,
      eval: (F) => reach(F.puReps, n, (v) => String(v), 'reps in one set'),
    })
  );
  [[20, 'silver'], [32, 'platinum']].forEach(([n, tier]) =>
    out.push({
      id: `pu-weighted-${n}`,
      cat: 'pullups',
      tier,
      name: `Pull-up +${n} kg`,
      desc: `A weighted pull-up single with ${n} kg added.`,
      eval: (F) => reach(F.puKg, n, (v) => `+${kg(v)}`, 'kg added'),
    })
  );
  return out;
}

function kettlebellDefs() {
  const ladders = (minKg) => (F) => {
    const s = runningMax(F.press.filter((p) => p.kg >= minKg - EPS).map((p) => ({ ...p, value: ladderGoalReps(p.ladders) })));
    return reach(s, 75, (v) => String(v), `reps per arm toward 5 × 1-2-3-4-5 with ${minKg} kg`);
  };
  const timedBell = (field, minKg, note) => (F) => {
    const s = runningMax(F.timed.map((t) => ({ ...t, value: t[field] })));
    return reach(s, minKg, (v) => `${kg(v)}`, note);
  };
  const out = [
    { id: 'kb-press-20-ladders', tier: 'silver', name: 'Press ladders with 20 kg', desc: 'Kettlebell press: 5 ladders of 1-2-3-4-5 per arm with the 20 kg bell (or heavier).', eval: ladders(20) },
    {
      id: 'kb-press-32',
      tier: 'gold',
      name: 'Man among men',
      desc: 'Your first clean strict press with the 32 kg bell (each arm), logged in press ladders.',
      eval: (F) => reach(runningMax(F.press.map((p) => ({ ...p, value: p.kg }))), 32, (v) => kg(v), 'kg, heaviest bell pressed'),
    },
    {
      id: 'kb-press-32x5',
      tier: 'platinum',
      name: '32 kg press × 5',
      desc: '5 strict presses in a row with the 32 kg bell (each arm), e.g. a 1-2-3-4-5 ladder.',
      eval: (F) =>
        reach(
          runningMax(F.press.filter((p) => p.kg >= 32 - EPS).map((p) => ({ ...p, value: Math.max(0, ...p.ladders.map((l) => l.top | 0)) }))),
          5,
          (v) => String(v),
          'reps in a row with 32 kg'
        ),
    },
    { id: 'kb-press-32-ladders', tier: 'legendary', name: 'Press ladders with 32 kg', desc: 'Kettlebell press: 5 ladders of 1-2-3-4-5 per arm with the 32 kg bell.', eval: ladders(32) },
    { id: 'kb-simple-swings', tier: 'gold', name: 'Simple swings', desc: '100 one-arm swings with 32 kg in 5 minutes or less (type the time in the swings card).', eval: timedBell('sw', 32, 'kg: heaviest bell with 100 swings in 5:00') },
    { id: 'kb-simple-getups', tier: 'gold', name: 'Simple get-ups', desc: '10 get-ups with 32 kg in 10 minutes or less (type the time in the get-ups card).', eval: timedBell('gu', 32, 'kg: heaviest bell with 10 get-ups in 10:00') },
    {
      id: 'kb-simple',
      tier: 'platinum',
      name: "Pavel's Simple",
      desc: 'Simple swings and Simple get-ups with 32 kg, in the same session.',
      eval: (F) => reach(runningMax(F.timed.map((t) => ({ ...t, value: Math.min(t.sw, t.gu) }))), 32, (v) => kg(v), 'kg: both standards in one session'),
    },
    {
      id: 'kb-sinister',
      tier: 'legendary',
      name: "Pavel's Sinister",
      desc: '100 swings in 5 minutes and 10 get-ups in 10 minutes with 48 kg, in the same session.',
      eval: (F) => reach(runningMax(F.timed.map((t) => ({ ...t, value: Math.min(t.sw, t.gu) }))), 48, (v) => kg(v), 'kg: both standards in one session'),
    },
    { id: 'kb-swings-10k', tier: 'silver', name: '10,000 swings', desc: 'Lifetime kettlebell swings.', eval: (F) => reach(F.swings, 10000, int, 'swings') },
    { id: 'kb-swings-100k', tier: 'platinum', name: '100,000 swings', desc: 'Lifetime kettlebell swings.', eval: (F) => reach(F.swings, 100000, int, 'swings') },
    { id: 'kb-getups-1k', tier: 'gold', name: '1,000 get-ups', desc: 'Lifetime Turkish get-ups.', eval: (F) => reach(F.getups, 1000, int, 'get-ups') },
  ];
  return out.map((d) => ({ cat: 'kettlebell', ...d }));
}

function skillDefs() {
  const s = (move, n) => (F) => reach(F.skill[move], n, (v) => String(v), 'reps in a row, full range (no variation)');
  return [
    { id: 'pistol-1', tier: 'silver', name: 'First full pistol', desc: 'A full pistol squat on each leg (logged without a variation such as "to box").', eval: s('pistol', 1) },
    { id: 'pistol-5', tier: 'gold', name: '5 pistols', desc: '5 full pistol squats in a row on each leg.', eval: s('pistol', 5) },
    { id: 'oap-1', tier: 'gold', name: 'First one-arm push-up', desc: 'A full one-arm push-up with each arm (logged without a variation).', eval: s('oap', 1) },
    { id: 'oap-5', tier: 'platinum', name: '5 one-arm push-ups', desc: '5 full one-arm push-ups in a row with each arm.', eval: s('oap', 5) },
  ].map((d) => ({ cat: 'skills', ...d }));
}

function enduranceDefs() {
  return [[100, 'bronze'], [500, 'silver'], [1000, 'gold']].map(([n, tier]) => ({
    id: `run-${n}`,
    cat: 'endurance',
    tier,
    name: `${int(n)} km of warm-up runs`,
    desc: 'Lifetime distance of the warm-up runs logged with your gym sessions.',
    eval: (F) => reach(F.runKm, n, (v) => (Math.round(v * 10) / 10).toLocaleString('en-US'), 'km'),
  }));
}

function tonnageDefs() {
  return [
    [1, 'bronze', 'a car'],
    [10, 'silver', 'a city bus'],
    [100, 'gold', 'a blue whale'],
    [1000, 'platinum', "a cruise ship's anchor chain"],
  ].map(([t, tier, what]) => ({
    id: `tonnage-${t}`,
    cat: 'tonnage',
    tier,
    name: `${int(t)} t lifted`,
    desc: `Lifetime tonnage (weight × reps of every gym set and extra exercise): ${what}.`,
    eval: (F) => reach(F.tonnage, t * 1000, (v) => (Math.floor(v / 100) / 10).toLocaleString('en-US'), 't'),
  }));
}

function habitDefs() {
  return [
    {
      id: 'bw-12-weeks',
      cat: 'habits',
      tier: 'silver',
      name: 'Bodyweight 12 weeks',
      desc: 'Bodyweight logged 12 weeks in a row (Monday–Sunday weeks).',
      eval: (F) => {
        let run = 0;
        let prev = null;
        let earned = null;
        for (const b of F.bws) {
          const wk = weekStart(b.date);
          if (prev && wk.getTime() === prev.getTime()) continue;
          run = prev && L.daysBetween(prev, wk) === 7 ? run + 1 : 1;
          prev = wk;
          if (run >= 12 && !earned) earned = at(b);
        }
        const alive = prev && L.daysBetween(prev, weekStart(F.now)) <= 7;
        return result(earned, alive ? run : 0, 12, (v) => String(v), 'weeks in a row');
      },
    },
    {
      id: 'fed-10',
      cat: 'habits',
      tier: 'silver',
      name: 'Fed and ready',
      desc: 'Ate before training ("Yes") at 10 gym sessions in a row.',
      eval: (F) => {
        let run = 0;
        let earned = null;
        for (const w of F.gym) {
          run = w.fed === true ? run + 1 : 0;
          if (run >= 10 && !earned) earned = at(w);
        }
        return result(earned, run, 10, (v) => String(v), 'sessions in a row');
      },
    },
  ];
}

function hiddenDefs() {
  return [
    {
      id: 'comrade-returns',
      cat: 'hidden',
      tier: 'bronze',
      hidden: true,
      name: 'Comrade Returns',
      desc: `Back to training after ${COMEBACK_DAYS}+ days away.`,
      eval: (F) => {
        const all = L.sortByDate([...F.gym, ...F.home]);
        let earned = null;
        for (let i = 1; i < all.length && !earned; i++) if (L.daysBetween(all[i - 1].date, all[i].date) >= COMEBACK_DAYS) earned = at(all[i]);
        return result(earned, 0, 1);
      },
    },
    {
      id: 'slacker',
      cat: 'hidden',
      tier: 'bronze',
      hidden: true,
      name: 'Slacker but Consistent',
      desc: 'A whole 6-session cycle done, every session after its due date.',
      eval: (F) => {
        const byId = new Map(F.timeline.map((t) => [t.w.id, t]));
        let earned = null;
        for (const b of F.blocks)
          for (const c of b.cycles) if (c.length === 6 && c.every((w) => byId.get(w.id).late >= 1)) earned = earliest([earned, at(c[5])]);
        return result(earned, 0, 1);
      },
    },
  ];
}

export const ACHIEVEMENTS = [
  ...ratioDefs(),
  ...plateDefs(),
  ...totalDefs(),
  ...programDefs(),
  ...consistencyDefs(),
  ...disciplineDefs(),
  ...pullupDefs(),
  ...kettlebellDefs(),
  ...skillDefs(),
  ...enduranceDefs(),
  ...tonnageDefs(),
  ...habitDefs(),
  ...hiddenDefs(),
];
export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Every achievement with its state: [{ def, tier, xp, earned, pct, text, note }]. */
export function achievementList(workouts, settings, now = new Date()) {
  const F = buildFacts(workouts, settings || L.defaultSettings(), now);
  return ACHIEVEMENTS.map((def) => {
    const r = def.eval(F);
    return { def, tier: TIER[def.tier], xp: TIER[def.tier].xp, ...r };
  });
}

/** The 3 closest achievements not earned yet (highest progress first; hidden ones never show). */
export function closest(list, n = 3) {
  return list
    .filter((a) => !a.earned && !a.def.hidden)
    .sort((a, b) => b.pct - a.pct || a.tier.rank - b.tier.rank)
    .slice(0, n);
}

/** Sorting and filters for the full list. sort: easy | hard | close; filter: all | done | todo. */
export function sortAndFilter(list, sort = 'easy', filter = 'all') {
  let out = list.filter((a) => (a.def.hidden ? !!a.earned : true));
  if (filter === 'done') out = out.filter((a) => a.earned);
  if (filter === 'todo') out = out.filter((a) => !a.earned);
  const idx = new Map(ACHIEVEMENTS.map((d, i) => [d.id, i]));
  const cmp = {
    easy: (a, b) => a.tier.rank - b.tier.rank || idx.get(a.def.id) - idx.get(b.def.id),
    hard: (a, b) => b.tier.rank - a.tier.rank || idx.get(a.def.id) - idx.get(b.def.id),
    close: (a, b) => (b.earned ? 1 : 0) - (a.earned ? 1 : 0) || b.pct - a.pct || a.tier.rank - b.tier.rank,
  }[sort] || (() => 0);
  return [...out].sort(cmp);
}

/** Grouped by category, in category order: [{ cat, items }]. */
export function groupByCategory(list) {
  return CATEGORIES.map((c) => ({ cat: c, items: list.filter((a) => a.def.cat === c.id) })).filter((g) => g.items.length);
}

// ---------- records ----------

/** Record wall: per lift, the best weight for 1, 3 and 5 clean reps (a set of at least that many reps).
 *  { squat: { 1: { weight, reps, date, refId } | null, 3: …, 5: … }, … }. The earliest day at that weight is kept. */
export function recordWall(workouts) {
  const out = {};
  for (const l of L.LIFTS) {
    out[l.id] = {};
    const hist = L.liftHistory((workouts || []).filter(Boolean), l.id);
    for (const r of RECORD_REPS) {
      let best = null;
      for (const h of hist)
        for (const s of h.sets)
          if (s.reps >= r && s.weight > 0 && (!best || s.weight > best.weight + EPS || (h.id === best.refId && s.weight === best.weight && s.reps > best.reps)))
            best = { weight: s.weight, reps: s.reps, date: h.date, refId: h.id };
      out[l.id][r] = best;
    }
  }
  return out;
}

/** Records the given workout set: [{ lift, reps, weight, prev }]. The first time a lift is logged isn't a "new record". */
export function newRecords(workouts, refId) {
  const before = recordWall((workouts || []).filter((w) => w && w.id !== refId));
  const after = recordWall(workouts);
  const out = [];
  for (const l of L.LIFTS)
    for (const r of RECORD_REPS) {
      const a = after[l.id][r];
      const b = before[l.id][r];
      if (a && a.refId === refId && b && a.weight > b.weight + EPS) out.push({ lift: l.id, reps: r, weight: a.weight, prev: b.weight });
    }
  return out;
}

// ---------- then vs now ----------

/** First logged numbers vs your best ever, per lift, plus first vs latest bodyweight. */
export function thenVsNow(workouts) {
  const ws = (workouts || []).filter(Boolean);
  const lifts = [];
  for (const l of L.LIFTS) {
    const hist = L.liftHistory(ws, l.id).filter((h) => h.top > 0);
    if (!hist.length) continue;
    const f = hist[0];
    const then = { weight: f.top, reps: Math.max(...f.sets.filter((s) => s.weight === f.top).map((s) => s.reps)), date: f.date };
    let now = null;
    for (const h of hist)
      for (const s of h.sets)
        if (!now || s.weight > now.weight + EPS || (s.weight === now.weight && s.reps > now.reps)) now = { weight: s.weight, reps: s.reps, date: h.date };
    lifts.push({ lift: l.id, then, now, diff: Math.round((now.weight - then.weight) * 1000) / 1000 });
  }
  const bws = bwEntries(ws).filter((b) => n0(b.kg) > 0);
  const bw = bws.length
    ? { then: { kg: n0(bws[0].kg), date: bws[0].date }, now: { kg: n0(bws[bws.length - 1].kg), date: bws[bws.length - 1].date }, count: bws.length }
    : null;
  if (bw) bw.diff = Math.round((bw.now.kg - bw.then.kg) * 10) / 10;
  return { lifts, bw };
}
