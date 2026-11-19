// Strength Log — home sessions (Simple & Sinister, kettlebell press ladders, bodyweight, custom).
// Pure functions. Home sessions are kind: 'home' workouts and never touch the gym plan.

import { sortByDate } from './logic.js';

/** Movements. kind: warmup | reps | secs | ladders | pullups */
export const MOVES = {
  warmup: {
    name: 'S&S warm-up',
    kind: 'warmup',
    about: 'Goblet squat ×5, halo ×5 each direction, hip bridge ×5',
  },
  swings: { name: 'Swings', kind: 'reps', kg: true, total: true, def: { kg: 20, sets: [{ reps: 100 }] } },
  getups: { name: 'Get-ups', kind: 'reps', kg: true, total: true, def: { kg: 20, sets: [{ reps: 10 }] } },
  press: {
    name: 'Kettlebell press ladders',
    kind: 'ladders',
    kg: true,
    about: 'Rite of Passage press: ladders per arm, e.g. 1-2-3. Goal for a bell: 5 ladders of 1-2-3-4-5 per arm, then a heavier bell. Long-term goal: press the 32 kg bell.',
    def: { kg: 20, ladders: [{ top: 3 }, { top: 3 }, { top: 3 }] },
  },
  pistol: { name: 'Pistol squat', kind: 'reps', per: 'per leg', variation: true, def: { sets: [{ reps: 5 }] } },
  oap: { name: 'One-arm push-up', kind: 'reps', per: 'per arm', variation: true, def: { sets: [{ reps: 5 }] } },
  plank: {
    name: 'Hardstyle plank',
    kind: 'secs',
    about: 'Pavel: 3–5 sets, held no more than 10 seconds, maximum tension.',
    def: { sets: [{ secs: 10 }, { secs: 10 }, { secs: 10 }] },
  },
  pullups: { name: 'Pull-ups', kind: 'pullups' },
  custom: { name: 'Custom', kind: 'reps', kg: true, named: true, def: { name: '', kg: null, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] } },
};

export const PRESETS = [
  { id: 'ss', name: 'Simple & Sinister', moves: ['warmup', 'swings', 'getups'], about: 'Warm-up, swings, get-ups' },
  { id: 'press', name: 'Kettlebell press ladders', moves: ['press'], about: 'Rite of Passage press' },
  { id: 'bw', name: 'Bodyweight', moves: ['pistol', 'oap', 'plank'], about: 'Pistol, one-arm push-up, hardstyle plank' },
  { id: 'pullups', name: 'Pull-ups', moves: ['pullups'], about: "Today's ladder from your pull-up program" },
  { id: 'custom', name: 'Custom', moves: ['custom'], about: 'Any movement: sets × reps × weight' },
];

export const PRESS_GOAL = { ladders: 5, top: 5 }; // 5 ladders of 1-2-3-4-5 per arm
export const PRESS_LONG_TERM_KG = 32;

const clone = (x) => JSON.parse(JSON.stringify(x));

/** The movements of a home session (v3 sessions stored swings/get-ups as separate fields). */
export function homeItems(w) {
  if (!w || w.kind !== 'home') return [];
  if (Array.isArray(w.items)) return w.items;
  const items = [];
  if (w.swings) items.push({ move: 'swings', kg: w.swings.kg, sets: [{ reps: w.swings.reps }] });
  if (w.getups) items.push({ move: 'getups', kg: w.getups.kg, sets: [{ reps: w.getups.reps }] });
  return items;
}

function sameMove(it, move, name) {
  if (it.move !== move) return false;
  return move !== 'custom' || (it.name || '').trim().toLowerCase() === (name || '').trim().toLowerCase();
}

/** The most recent logged version of a movement (for custom: same name), or null. */
export function lastItem(workouts, move, name, excludeId) {
  const home = sortByDate((workouts || []).filter((w) => w && w.kind === 'home' && w.id !== excludeId)).reverse();
  for (const w of home) {
    const it = homeItems(w).find((x) => sameMove(x, move, name));
    if (it) return it;
  }
  return null;
}

/** Practice sets added with "+1 set" carry a time; the planned sets don't. */
function baseSets(list) {
  const planned = (list || []).filter((s) => !s.time);
  const use = planned.length ? planned : (list || []).slice(0, 1);
  return use.map(({ time, ...rest }) => rest);
}

/** A new movement entry, pre-filled with the last values used for it (or the defaults). */
export function newItem(move, workouts, opts = {}) {
  const m = MOVES[move];
  if (!m) throw new Error('Unknown movement ' + move);
  if (m.kind === 'pullups') return { move };
  const last = lastItem(workouts, move, opts.name, opts.excludeId);
  if (m.kind === 'warmup') return { move, done: false, rounds: last ? last.rounds || 1 : 1 };
  if (m.kind === 'ladders') {
    const src = last || m.def;
    return { move, kg: src.kg, ladders: baseSets(src.ladders) };
  }
  const src = last || m.def;
  const it = { move, sets: baseSets(src.sets) };
  if (m.kg) it.kg = src.kg ?? null;
  if (m.variation) it.variation = (last && last.variation) || '';
  if (m.named) it.name = opts.name ?? (src.name || '');
  return it;
}

/** "+1 set": adds a set (or ladder) like the last one, stamped with the time. */
export function addSet(item, now = new Date()) {
  const time = new Date(now).toISOString();
  const m = MOVES[item.move];
  if (m.kind === 'ladders') {
    const last = item.ladders[item.ladders.length - 1] || { top: 1 };
    item.ladders.push({ top: last.top, time });
  } else {
    const last = item.sets[item.sets.length - 1] || (m.kind === 'secs' ? { secs: 10 } : { reps: 5 });
    const { time: _t, ...rest } = last;
    item.sets.push({ ...rest, time });
  }
  return item;
}

export function ladderReps(ladders) {
  return (ladders || []).reduce((s, l) => s + (l.top * (l.top + 1)) / 2, 0);
}

export function rungText(top) {
  return Array.from({ length: top }, (_, i) => i + 1).join('-');
}

/** "3 × 1-2-3" or "1-2-3, 1-2-3, 1-2" */
export function ladderText(ladders) {
  if (!ladders || !ladders.length) return 'no ladders';
  const tops = ladders.map((l) => l.top);
  if (tops.every((t) => t === tops[0])) return `${tops.length} × ${rungText(tops[0])}`;
  return tops.map(rungText).join(', ');
}

/** Press-ladder progress for a bell: last session and best, against Pavel's goal. */
export function pressProgress(workouts, kg) {
  const hist = homeHistory(workouts, 'press').filter((h) => Number(h.item.kg) === Number(kg));
  const last = hist[hist.length - 1] || null;
  let best = null;
  for (const h of hist) if (!best || ladderReps(h.item.ladders) > ladderReps(best.item.ladders)) best = h;
  const goalReps = PRESS_GOAL.ladders * ((PRESS_GOAL.top * (PRESS_GOAL.top + 1)) / 2);
  const reached = hist.some(
    (h) => h.item.ladders.filter((l) => l.top >= PRESS_GOAL.top).length >= PRESS_GOAL.ladders
  );
  return {
    last: last && { date: last.date, text: `${ladderText(last.item.ladders)} with ${kg} kg`, reps: ladderReps(last.item.ladders) },
    best: best && { date: best.date, text: ladderText(best.item.ladders), reps: ladderReps(best.item.ladders) },
    goalText: `${PRESS_GOAL.ladders} ladders of ${rungText(PRESS_GOAL.top)} per arm`,
    goalReps,
    reached,
  };
}

export function itemTotal(item) {
  const m = MOVES[item.move];
  if (!m) return 0;
  if (m.kind === 'ladders') return ladderReps(item.ladders);
  if (m.kind === 'secs') return (item.sets || []).reduce((s, x) => s + (x.secs || 0), 0);
  if (m.kind === 'reps') return (item.sets || []).reduce((s, x) => s + (x.reps || 0), 0);
  return 0;
}

/** "4:45" for a time in seconds (swings / get-ups time box, for Pavel's Simple standard). */
export function durText(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

/** Short text for history lists. */
export function itemSummary(item) {
  const m = MOVES[item.move];
  if (!m) return '';
  const kgTxt = item.kg ? ` × ${item.kg} kg` : '';
  const name = m.named ? item.name || 'Custom' : m.name;
  if (m.kind === 'warmup') return item.done ? `Warm-up ${item.rounds || 1} round${(item.rounds || 1) > 1 ? 's' : ''}` : '';
  if (m.kind === 'ladders') return `Press ${ladderText(item.ladders)} with ${item.kg} kg`;
  if (m.kind === 'secs') return `Plank ${item.sets.map((s) => s.secs + 's').join(', ')}`;
  if (m.kind === 'pullups') return '';
  if (m.total) return `${name} ${itemTotal(item)}${kgTxt}${item.durationSec > 0 ? ` in ${durText(item.durationSec)}` : ''}`;
  const v = item.variation ? ` (${item.variation})` : '';
  return `${name}${v} ${item.sets.map((s) => s.reps).join(',')}${kgTxt}`;
}

/** Every logged instance of a movement, oldest first: [{ id, date, item }]. */
export function homeHistory(workouts, move, name) {
  const out = [];
  for (const w of sortByDate((workouts || []).filter((x) => x && x.kind === 'home'))) {
    for (const it of homeItems(w)) if (sameMove(it, move, name)) out.push({ id: w.id, date: w.date, item: it });
  }
  return out;
}

/** Movements that have been logged at home (for the Progress tab). */
export function loggedMoves(workouts) {
  const seen = new Map();
  for (const w of sortByDate((workouts || []).filter((x) => x && x.kind === 'home'))) {
    for (const it of homeItems(w)) {
      const m = MOVES[it.move];
      if (!m || m.kind === 'warmup' || m.kind === 'pullups') continue;
      const key = it.move === 'custom' ? 'custom:' + (it.name || '').trim().toLowerCase() : it.move;
      if (it.move === 'custom' && !(it.name || '').trim()) continue;
      seen.set(key, { key, move: it.move, name: m.named ? it.name.trim() : m.name });
    }
  }
  return [...seen.values()];
}

/** Chart series and bests for a movement in the Progress tab. */
export function homeProgress(workouts, move, name) {
  const m = MOVES[move];
  const hist = homeHistory(workouts, move, name);
  const charts = [];
  const bests = [];
  const pt = (h, value, tip) => ({ date: h.date, value, tip });
  if (m.kind === 'ladders') {
    charts.push({ title: 'Total reps per arm', points: hist.map((h) => pt(h, ladderReps(h.item.ladders), `${ladderText(h.item.ladders)} with ${h.item.kg} kg`)) });
    charts.push({ title: 'Bell (kg)', points: hist.map((h) => pt(h, Number(h.item.kg), `${ladderText(h.item.ladders)}`)) });
    const bells = [...new Set(hist.map((h) => Number(h.item.kg)))].sort((a, b) => b - a);
    for (const kg of bells) {
      const p = pressProgress(workouts, kg);
      bests.push({ label: `${kg} kg: best ${p.best.text} (${p.best.reps} reps per arm)`, date: p.best.date, extra: p.reached ? 'goal reached ✓' : `goal ${p.goalText}` });
    }
  } else if (m.kind === 'secs') {
    charts.push({ title: 'Longest hold (seconds)', points: hist.map((h) => pt(h, Math.max(...h.item.sets.map((s) => s.secs || 0)), h.item.sets.map((s) => s.secs + 's').join(', '))) });
    const all = hist.flatMap((h) => h.item.sets.map((s) => ({ v: s.secs || 0, date: h.date })));
    all.sort((a, b) => b.v - a.v);
    if (all[0]) bests.push({ label: `Longest hold: ${all[0].v} s`, date: all[0].date });
  } else if (m.total) {
    charts.push({ title: 'Bell (kg)', points: hist.map((h) => pt(h, Number(h.item.kg) || 0, `${itemTotal(h.item)} reps`)) });
    charts.push({ title: 'Total reps', points: hist.map((h) => pt(h, itemTotal(h.item), `with ${h.item.kg} kg`)) });
    const byBell = [...hist].sort((a, b) => (b.item.kg || 0) - (a.item.kg || 0) || itemTotal(b.item) - itemTotal(a.item));
    if (byBell[0]) bests.push({ label: `Heaviest bell: ${byBell[0].item.kg} kg × ${itemTotal(byBell[0].item)}`, date: byBell[0].date });
    const byReps = [...hist].sort((a, b) => itemTotal(b.item) - itemTotal(a.item));
    if (byReps[0]) bests.push({ label: `Most reps: ${itemTotal(byReps[0].item)} with ${byReps[0].item.kg} kg`, date: byReps[0].date });
  } else {
    const hasKg = hist.some((h) => h.item.kg);
    if (hasKg) charts.push({ title: 'Weight (kg)', points: hist.map((h) => pt(h, Number(h.item.kg) || 0, h.item.sets.map((s) => s.reps).join(','))) });
    charts.push({
      title: 'Best set (reps)',
      points: hist.map((h) => pt(h, Math.max(...h.item.sets.map((s) => s.reps || 0)), h.item.sets.map((s) => s.reps).join(',') + (h.item.variation ? ` · ${h.item.variation}` : ''))),
    });
    const all = hist.flatMap((h) => h.item.sets.map((s) => ({ reps: s.reps || 0, kg: h.item.kg, variation: h.item.variation, date: h.date })));
    all.sort((a, b) => (b.kg || 0) - (a.kg || 0) || b.reps - a.reps);
    const seen = new Set();
    for (const x of all) {
      const k = `${x.kg}|${x.reps}|${x.variation || ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      bests.push({ label: `${x.reps} reps${x.kg ? ` × ${x.kg} kg` : ''}${x.variation ? ` (${x.variation})` : ''}`, date: x.date });
      if (bests.length >= 5) break;
    }
  }
  return { charts, bests };
}

export { clone as cloneItem };
