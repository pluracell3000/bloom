// Set a DST-observing zone BEFORE any Date use so local-midnight logic is
// actually exercised across spring-forward and fall-back.
process.env.TZ = "America/New_York";

import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERVALS,
  dayKey,
  isDayKey,
  addDays,
  diffDays,
  unreadState,
  markRead,
  recordReview,
  nextDue,
  isDue,
  isRead,
} from "../site/scheduler.mjs";

test("intervals are the spec's gentle schedule", () => {
  assert.deepEqual(INTERVALS, [3, 14, 45]);
});

test("dayKey formats local calendar days", () => {
  assert.equal(dayKey(new Date(2026, 7, 16, 0, 0, 1)), "2026-08-16");
  assert.equal(dayKey(new Date(2026, 7, 16, 23, 59, 59)), "2026-08-16");
  assert.ok(isDayKey("2026-08-16"));
  assert.ok(!isDayKey("2026-8-16"));
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("addDays is DST-safe across US spring forward (2026-03-08)", () => {
  // The night of Mar 8 2026 is only 23h long in America/New_York.
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-07", 3), "2026-03-10");
  assert.equal(addDays("2026-03-05", 3), "2026-03-08");
});

test("addDays is DST-safe across US fall back (2026-11-01)", () => {
  // The night of Nov 1 2026 is 25h long.
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
});

test("diffDays counts calendar days", () => {
  assert.equal(diffDays("2026-03-07", "2026-03-10"), 3); // across spring forward
  assert.equal(diffDays("2026-10-30", "2026-11-02"), 3); // across fall back
  assert.equal(diffDays("2026-08-16", "2026-08-16"), 0);
  assert.equal(diffDays("2026-08-16", "2026-08-15"), -1);
});

test("unread cards are never due", () => {
  const cs = unreadState();
  assert.equal(isRead(cs), false);
  assert.equal(nextDue(cs), null);
  assert.equal(isDue(cs, "2099-01-01"), false);
});

test("interval progression: read → +3 → +14 → +45 → retired", () => {
  let cs = markRead("2026-08-16");
  assert.equal(isRead(cs), true);
  assert.equal(nextDue(cs), "2026-08-19");
  assert.equal(isDue(cs, "2026-08-18"), false);
  assert.equal(isDue(cs, "2026-08-19"), true);

  cs = recordReview(cs, "2026-08-19");
  assert.equal(cs.retired, false);
  assert.equal(nextDue(cs), "2026-09-02"); // +14 from the review

  cs = recordReview(cs, "2026-09-02");
  assert.equal(cs.retired, false);
  assert.equal(nextDue(cs), "2026-10-17"); // +45 from the review

  cs = recordReview(cs, "2026-10-17");
  assert.equal(cs.retired, true);
  assert.equal(nextDue(cs), null);
  assert.equal(isDue(cs, "2099-01-01"), false);
});

test("late reviews reschedule from the review day (no pile-up)", () => {
  let cs = markRead("2026-08-01"); // due 2026-08-04
  assert.equal(isDue(cs, "2026-08-20"), true); // opened late — still just 'due'
  cs = recordReview(cs, "2026-08-20");
  assert.equal(nextDue(cs), "2026-09-03"); // +14 from the actual review, not from Aug 4
});

test("a due date stays due on later days (lexicographic compare)", () => {
  const cs = markRead("2026-08-16");
  assert.equal(isDue(cs, "2026-09-01"), true);
});

test("day-boundary edge: due exactly at local midnight boundary", () => {
  const cs = markRead("2026-08-16");
  // Any Date within the due day maps to the same key.
  const justAfterMidnight = new Date(2026, 7, 19, 0, 0, 1);
  const justBeforeMidnight = new Date(2026, 7, 18, 23, 59, 59);
  assert.equal(isDue(cs, dayKey(justAfterMidnight)), true);
  assert.equal(isDue(cs, dayKey(justBeforeMidnight)), false);
});
