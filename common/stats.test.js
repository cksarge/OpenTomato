import { test } from "node:test";
import assert from "node:assert/strict";
import {
  windowStartMs,
  focusMsInWindow,
  inProgressFocusMs,
  totalFocusMs,
  formatFocusDuration,
} from "./stats.js";
import { STATS_WINDOW, PHASE, STATUS } from "./constants.js";

// A fixed, known instant: Wednesday 2026-09-09 14:37:20 local time.
const NOW = new Date(2026, 8, 9, 14, 37, 20, 0).getTime();

test("windowStartMs: HOUR rounds back to the top of the current hour", () => {
  const start = windowStartMs(STATS_WINDOW.HOUR, NOW);
  const d = new Date(start);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
});

test("windowStartMs: DAY rounds back to local midnight", () => {
  const start = windowStartMs(STATS_WINDOW.DAY, NOW);
  const d = new Date(start);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 9);
});

test("windowStartMs: WEEK rounds back to the most recent Sunday", () => {
  const start = windowStartMs(STATS_WINDOW.WEEK, NOW);
  const d = new Date(start);
  assert.equal(d.getDay(), 0); // Sunday
  assert.ok(d.getTime() <= NOW);
  assert.ok(NOW - d.getTime() < 7 * 24 * 60 * 60 * 1000);
});

test("windowStartMs: MONTH rounds back to the 1st of the current month", () => {
  const start = windowStartMs(STATS_WINDOW.MONTH, NOW);
  const d = new Date(start);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 8); // September (0-indexed)
});

test("windowStartMs: ALL is always epoch 0", () => {
  assert.equal(windowStartMs(STATS_WINDOW.ALL, NOW), 0);
});

test("windowStartMs: unknown window falls back to DAY behavior", () => {
  assert.equal(windowStartMs("bogus", NOW), windowStartMs(STATS_WINDOW.DAY, NOW));
});

test("focusMsInWindow sums only entries that end within [windowStart, now]", () => {
  const dayStart = windowStartMs(STATS_WINDOW.DAY, NOW);
  const stats = {
    resetAt: 0,
    focusLog: [
      { end: dayStart - 1000, ms: 999999 }, // before today: excluded
      { end: dayStart + 1000, ms: 60000 }, // today: included
      { end: NOW - 1000, ms: 120000 }, // today: included
      { end: NOW + 999999, ms: 500000 }, // in the future somehow: excluded
    ],
  };
  assert.equal(focusMsInWindow(stats, STATS_WINDOW.DAY, NOW), 180000);
});

test("focusMsInWindow never counts entries from before the last reset, even in ALL window", () => {
  const resetAt = NOW - 60000;
  const stats = {
    resetAt,
    focusLog: [
      { end: resetAt - 5000, ms: 999999 }, // before reset: excluded
      { end: resetAt + 5000, ms: 30000 }, // after reset: included
    ],
  };
  assert.equal(focusMsInWindow(stats, STATS_WINDOW.ALL, NOW), 30000);
});

test("focusMsInWindow tolerates missing/malformed stats gracefully", () => {
  assert.equal(focusMsInWindow(undefined, STATS_WINDOW.DAY, NOW), 0);
  assert.equal(focusMsInWindow({}, STATS_WINDOW.DAY, NOW), 0);
  assert.equal(focusMsInWindow({ focusLog: [null, { end: "not a number", ms: 5 }] }, STATS_WINDOW.ALL, NOW), 0);
});

test("inProgressFocusMs is 0 outside a WORK phase", () => {
  const settings = { workMinutes: 25 };
  assert.equal(
    inProgressFocusMs({ phase: PHASE.REST, status: STATUS.RUNNING, phaseEndTime: NOW + 1000 }, settings, NOW),
    0
  );
  assert.equal(inProgressFocusMs(null, settings, NOW), 0);
});

test("inProgressFocusMs computes elapsed time for a running work phase", () => {
  const settings = { workMinutes: 25 };
  const fullMs = 25 * 60 * 1000;
  const timerState = { phase: PHASE.WORK, status: STATUS.RUNNING, phaseEndTime: NOW + fullMs - 60000 };
  // 60s have elapsed out of the full 25 minutes.
  assert.equal(inProgressFocusMs(timerState, settings, NOW), 60000);
});

test("inProgressFocusMs computes elapsed time for a paused work phase", () => {
  const settings = { workMinutes: 25 };
  const fullMs = 25 * 60 * 1000;
  const timerState = { phase: PHASE.WORK, status: STATUS.PAUSED, remainingMsWhenPaused: fullMs - 120000 };
  assert.equal(inProgressFocusMs(timerState, settings, NOW), 120000);
});

test("inProgressFocusMs clamps to [0, fullMs] even with odd inputs", () => {
  const settings = { workMinutes: 25 };
  const fullMs = 25 * 60 * 1000;
  // phaseEndTime way in the future -> elapsed would be negative -> clamp to 0.
  const notStarted = { phase: PHASE.WORK, status: STATUS.RUNNING, phaseEndTime: NOW + fullMs + 999999 };
  assert.equal(inProgressFocusMs(notStarted, settings, NOW), 0);
  // phaseEndTime way in the past (overdue alarm) -> elapsed would exceed fullMs -> clamp to fullMs.
  const overdue = { phase: PHASE.WORK, status: STATUS.RUNNING, phaseEndTime: NOW - 999999 };
  assert.equal(inProgressFocusMs(overdue, settings, NOW), fullMs);
});

test("totalFocusMs adds logged time plus the live in-progress session", () => {
  const settings = { workMinutes: 25, statsWindow: STATS_WINDOW.DAY };
  const dayStart = windowStartMs(STATS_WINDOW.DAY, NOW);
  const stats = { resetAt: 0, focusLog: [{ end: dayStart + 1000, ms: 600000 }] }; // 10m logged today
  const timerState = { phase: PHASE.WORK, status: STATUS.RUNNING, phaseEndTime: NOW + 25 * 60 * 1000 - 60000 };
  // +10m logged, +1m in progress
  assert.equal(totalFocusMs(stats, timerState, settings, NOW), 660000);
});

test("totalFocusMs clamps the live portion to time-since-reset, so a just-reset session doesn't double count", () => {
  const settings = { workMinutes: 25, statsWindow: STATS_WINDOW.ALL };
  const resetAt = NOW - 30000; // reset 30s ago, mid-session
  const stats = { resetAt, focusLog: [] };
  // The work phase actually started 10 minutes ago (long before the reset),
  // but only the 30s since the reset should count.
  const timerState = {
    phase: PHASE.WORK,
    status: STATUS.RUNNING,
    phaseEndTime: NOW + 25 * 60 * 1000 - 10 * 60 * 1000,
  };
  assert.equal(totalFocusMs(stats, timerState, settings, NOW), 30000);
});

test("formatFocusDuration formats minutes and hours", () => {
  assert.equal(formatFocusDuration(0), "0m");
  assert.equal(formatFocusDuration(45 * 60000), "45m");
  assert.equal(formatFocusDuration(60 * 60000), "1h");
  assert.equal(formatFocusDuration(125 * 60000), "2h 5m");
});
