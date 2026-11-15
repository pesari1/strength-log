// Strength Log — Pavel's Fighter Pullup Program.
// Pure functions. Pull-up sessions are stored inside gym workouts (workout.pullups) or home
// sessions (an item with move: 'pullups'). They never touch the gym plan.
//
// A pull-up session record: { mode: 'ladder' | 'test' | 'free', ladder: [targets] | null,
//                             sets: [{ reps, done }], kg }
// Records without `mode` (pull-ups logged before v4) are history only.

import { sortByDate, localDay, daysBetween, addDays } from './logic.js';
import { homeItems } from './home.js';

/** Pavel's published 3RM program, days 1–12 (null = day off), as provided by the user.
 *  Then the 5RM program from 5, 4, 3, 2, 1. Days 1–5 have four sets. */
export const PULLUP_3RM_TABLE = [
  [3, 2, 1, 1], // day 1
  [3, 2, 1, 1], // day 2
  [3, 2, 2, 1], // day 3
  [3, 3, 2, 1], // day 4
  [4, 3, 2, 1], // day 5
  null, // day 6: off
  [4, 3, 2, 1, 1], // day 7
  [4, 3, 2, 2, 1], // day 8
  [4, 3, 3, 2, 1], // day 9
  [4, 4, 3, 2, 1], // day 10
  [5, 4, 3, 2, 1], // day 11
  null, // day 12: off
];

export const WEEK_SESSIONS = 5; // pull-up sessions per "week"; Pavel's day 6 is off
export const CYCLE_SESSIONS = 25; // 5 weeks = Pavel's 30 days, then test
export const LONG_BREAK_DAYS = 14;

function ts(d) {
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Which program a max picks. */
export function pickProgram(max, table3rm = PULLUP_3RM_TABLE) {
  const m = Math.floor(Number(max));
  if (!(m >= 3)) {
    return { id: 'free', name: 'No program yet — log pull-ups freely', about: 'With a max under 3 there is no program. Log your pull-ups and retest your max later.' };
  }
  if (m <= 4) {
    if (!table3rm) {
      return { id: 'free', name: "Pavel's 3RM program (not added to the app yet)", about: 'Log pull-ups freely until the 3RM table is added.', wants: '3rm' };
    }
    return {
      id: '3rm',
      name: "Pavel's 3RM program",
      about: 'Days 1–12 as published (day 1: 3, 2, 1, 1; days 6 and 12 off), then the 5RM program from 5, 4, 3, 2, 1.',
    };
  }
  if (m <= 12) {
    return {
      id: '5rm',
      name: "Pavel's 5RM program, starting at your max",
      about: `First ladder: ${[m, m - 1, m - 2, m - 3, m - 4].join(', ')}.`,
      base: [m, m - 1, m - 2, m - 3, m - 4],
      step: 1,
    };
  }
  return { id: '15rm', name: "Pavel's 15RM program", about: 'First ladder: 12, 10, 8, 6, 4 (steps of 2).', base: [12, 10, 8, 6, 4], step: 2 };
}

function startState(max, kg, table3rm) {
  const p = pickProgram(max, table3rm);
  return {
    program: p,
    max: Number(max),
    kg: kg || 0,
    phase: p.id === 'free' ? 'free' : 'ladder',
    base: p.base ? [...p.base] : null,
    step: p.step || 0,
    n: 1, // session within the week (1–5)
    done: 0, // completed ladders this cycle (toward 25)
    idx: 0, // position in the 3RM table
    offAfter: null, // date of the session after which the next calendar day is off
    missed: null,
  };
}

function skipOff(st, table, date) {
  while (st.idx < table.length && table[st.idx] == null) {
    st.offAfter = date;
    st.idx++;
  }
}

function to5rm(st) {
  st.program = pickProgram(5);
  st.base = [...st.program.base];
  st.step = 1;
  st.n = 1;
  st.done = 0;
}

export function currentLadder(st, table3rm = PULLUP_3RM_TABLE) {
  if (st.phase !== 'ladder') return null;
  if (st.program.id === '3rm') return [...table3rm[st.idx]];
  const from = WEEK_SESSIONS - (st.n - 1);
  return st.base.map((r, i) => (i >= from ? r + st.step : r));
}

function advance(st, date, table3rm) {
  st.missed = null;
  if (st.program.id === '3rm') {
    st.idx++;
    skipOff(st, table3rm, date);
    if (st.idx >= table3rm.length) to5rm(st);
    return;
  }
  st.done++;
  st.n++;
  if (st.n > WEEK_SESSIONS) {
    st.n = 1;
    st.base = st.base.map((r) => r + st.step);
    st.offAfter = date;
  }
  if (st.done >= CYCLE_SESSIONS) st.phase = 'test';
}

/** All pull-up sessions (gym and home), oldest first; the first one each calendar day counts. */
export function pullupRecords(workouts) {
  const out = [];
  for (const w of workouts || []) {
    if (!w) continue;
    if (w.kind === 'gym' && w.pullups && w.pullups.mode) {
      out.push({ src: 'gym', id: w.id, date: w.date, createdAt: w.createdAt, rec: w.pullups });
    }
    if (w.kind === 'home') {
      for (const it of homeItems(w)) {
        if (it.move === 'pullups' && it.mode) out.push({ src: 'home', id: w.id, date: w.date, createdAt: w.createdAt, rec: it });
      }
    }
  }
  const sorted = sortByDate(out);
  const days = new Set();
  for (const r of sorted) {
    const k = localDay(r.date).getTime();
    r.counts = !days.has(k);
    days.add(k);
  }
  return sorted;
}

export function sessionReps(rec) {
  return (rec.sets || []).reduce((s, x) => s + (x.done ? x.reps | 0 : 0), 0);
}

function ladderComplete(rec) {
  const ladder = rec.ladder || [];
  return ladder.length > 0 && ladder.every((t, i) => rec.sets[i] && rec.sets[i].done && (rec.sets[i].reps | 0) >= t);
}

/** Replays the program from setup and returns today's plan. */
export function pullupState(workouts, settings, now = new Date(), opts = {}) {
  const table = opts.table3rm !== undefined ? opts.table3rm : PULLUP_3RM_TABLE;
  const setup = settings && settings.pullups;
  const records = pullupRecords(workouts);
  if (!setup || !(setup.max >= 0)) return { phase: 'setup', records };

  let st = startState(setup.max, setup.kg, table);
  const tests = [{ date: setup.at, max: Number(setup.max), kg: setup.kg || 0, source: 'setup' }];
  const since = ts(setup.at);
  let last = null;
  for (const r of records) {
    if (!r.counts) continue;
    if ((r.createdAt != null ? r.createdAt : ts(r.date)) < since) continue;
    last = r;
    const rec = r.rec;
    if (rec.mode === 'test') {
      const s = rec.sets && rec.sets[0];
      const max = s && s.done ? s.reps | 0 : 0;
      tests.push({ date: r.date, max, kg: rec.kg || 0, source: 'test' });
      st = startState(max, rec.kg, table);
      continue;
    }
    if (st.phase === 'ladder' && rec.mode === 'ladder') {
      if (ladderComplete(rec)) advance(st, r.date, table);
      else st.missed = { date: r.date, ladder: rec.ladder };
    }
  }

  const today = localDay(now);
  const doneToday = records.some((r) => r.counts && localDay(r.date).getTime() === today.getTime());
  const dayOff = !!st.offAfter && daysBetween(st.offAfter, now) === 1 && !doneToday;
  const daysSince = last ? daysBetween(last.date, now) : null;
  const ladder = currentLadder(st, table);
  let progress = '';
  if (st.phase === 'ladder' && st.program.id === '3rm') progress = `3RM program · session ${st.idx + 1 - countOff(table, st.idx)} of ${table.filter((x) => x).length}`;
  else if (st.phase === 'ladder') progress = `Week ${Math.floor(st.done / WEEK_SESSIONS) + 1}, session ${st.n} · ${st.done} of ${CYCLE_SESSIONS} done`;
  return {
    phase: st.phase, // ladder | test | free
    program: st.program,
    max: st.max,
    kg: st.kg,
    ladder,
    missed: st.missed,
    dayOff,
    doneToday,
    progress,
    tests,
    records,
    daysSince,
    longBreakNote: daysSince != null && daysSince >= LONG_BREAK_DAYS ? `${daysSince} days since last pull-up session` : null,
    text: planText(st.phase, ladder, dayOff),
  };
}

function countOff(table, idx) {
  let n = 0;
  for (let i = 0; i < idx; i++) if (table[i] == null) n++;
  return n;
}

function planText(phase, ladder, dayOff) {
  if (dayOff) return 'day off';
  if (phase === 'ladder') return `today's ladder: ${ladder.join(', ')}`;
  if (phase === 'test') return 'take a few rest days, then test your max';
  return 'log freely';
}

/** A new pull-up record for today's session, pre-filled with the targets. */
export function newPullupRecord(state, lastFree) {
  if (state.phase === 'ladder') {
    return { mode: 'ladder', ladder: [...state.ladder], sets: state.ladder.map((r) => ({ reps: r, done: false })), kg: state.kg || 0 };
  }
  if (state.phase === 'test') return { mode: 'test', ladder: null, sets: [{ reps: state.max || 1, done: false }], kg: state.kg || 0 };
  const sets = lastFree && lastFree.sets && lastFree.sets.length ? lastFree.sets.map((s) => ({ reps: s.reps, done: false })) : [{ reps: 1, done: false }];
  return { mode: 'free', ladder: null, sets, kg: state.kg || 0 };
}

/** Pull-up chart data: total reps per counted session, and the maxes. */
export function pullupProgress(workouts, settings) {
  const st = pullupState(workouts, settings);
  const sessions = (st.records || []).filter((r) => r.rec.mode !== 'test').map((r) => ({ date: r.date, value: sessionReps(r.rec), tip: (r.rec.sets || []).map((s) => (s.done ? s.reps : '–')).join(', ') + (r.counts ? '' : ' (didn\'t count)') }));
  return { sessions, tests: st.tests || [] };
}

export { addDays };
