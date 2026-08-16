// scheduler.mjs — pure due-date logic. No I/O, no globals beyond Date.
//
// Resurfacing: +3, +14, +45 days, question-first, then retire.
// Each interval is measured from the previous interaction (first read, then
// each review), which equals "+3/+14/+45 after first read" when reviews
// happen on time and degrades gently — no overdue pile-up — when they don't.
//
// All day math uses *local-midnight day boundaries*: days are represented as
// local "YYYY-MM-DD" keys, and arithmetic goes through local noon so DST
// transitions can never shift a result across a day boundary.

export const INTERVALS = [3, 14, 45];

/** Local calendar day of a Date as "YYYY-MM-DD". */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDayKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** key + n calendar days (n may be negative). DST-safe via local noon. */
export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const noon = new Date(y, m - 1, d + n, 12);
  return dayKey(noon);
}

/** Whole calendar days from a to b (positive when b is later). */
export function diffDays(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const utcA = Date.UTC(ay, am - 1, ad);
  const utcB = Date.UTC(by, bm - 1, bd);
  return Math.round((utcB - utcA) / 86400000);
}

/** Fresh per-card state: never read. */
export function unreadState() {
  return { first_read: null, last_review: null, interval_index: 0, retired: false };
}

/** Done in Zone A: the schedule starts today. */
export function markRead(today) {
  return { first_read: today, last_review: null, interval_index: 0, retired: false };
}

/**
 * Done in Zone B: record a review and advance the interval.
 * After the final (+45d) review the card retires.
 */
export function recordReview(cs, today) {
  const last = cs.interval_index >= INTERVALS.length - 1;
  return {
    ...cs,
    last_review: today,
    interval_index: last ? cs.interval_index : cs.interval_index + 1,
    retired: last,
  };
}

/** The day this card next surfaces in Zone B, or null (unread / retired). */
export function nextDue(cs) {
  if (!cs || !cs.first_read || cs.retired) return null;
  const anchor = cs.last_review ?? cs.first_read;
  return addDays(anchor, INTERVALS[cs.interval_index]);
}

/** Is the card due for Zone B on `today`? */
export function isDue(cs, today) {
  const due = nextDue(cs);
  return due !== null && due <= today; // ISO keys compare lexicographically
}

/** Has the card ever been read (i.e. left Zone A)? */
export function isRead(cs) {
  return Boolean(cs && cs.first_read);
}
