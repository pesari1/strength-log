// Strength Log — weekly bodyweight log. Entries are { id, kind: 'bw', date, createdAt, kg }.
// They never touch the gym plan.

import { sortByDate, daysBetween } from './logic.js';

export const BW_EVERY_DAYS = 7;

export function bwEntries(workouts) {
  return sortByDate((workouts || []).filter((w) => w && w.kind === 'bw'));
}

export function lastBw(workouts) {
  const all = bwEntries(workouts);
  return all[all.length - 1] || null;
}

/** "Log your bodyweight" shows when nothing is logged yet or 7+ days have passed since the last entry. */
export function bwDue(workouts, now = new Date()) {
  const last = lastBw(workouts);
  return !last || daysBetween(last.date, now) >= BW_EVERY_DAYS;
}

/** kg with one decimal. */
export function roundBw(kg) {
  return Math.round(Number(kg) * 10) / 10;
}
