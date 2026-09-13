import { test } from "node:test";
import assert from "node:assert/strict";
import { minutesToMs, durationMsForPhase, formatTime } from "./duration.js";
import { PHASE } from "./constants.js";

test("minutesToMs converts and rounds", () => {
  assert.equal(minutesToMs(25), 1500000);
  assert.equal(minutesToMs(0.5), 30000);
  assert.equal(minutesToMs(1.001), 60060); // rounds to nearest ms
});

test("minutesToMs never goes negative for numeric input", () => {
  assert.equal(minutesToMs(-5), 0);
});

test("minutesToMs on non-numeric input is NaN, not 0 (documents current behavior)", () => {
  // Number("nonsense") is NaN, and Math.max(0, NaN) is NaN in real JS (NaN
  // compares false to everything). Callers (options.js's readNumberField)
  // already guard against this before it reaches here — this test exists so
  // a future refactor of minutesToMs itself doesn't silently start throwing
  // or returning something callers don't expect.
  assert.ok(Number.isNaN(minutesToMs("nonsense")));
});

test("durationMsForPhase reads the right settings field per phase", () => {
  const settings = { workMinutes: 25, restMinutes: 5, longBreakMinutes: 15 };
  assert.equal(durationMsForPhase(PHASE.WORK, settings), 1500000);
  assert.equal(durationMsForPhase(PHASE.REST, settings), 300000);
  assert.equal(durationMsForPhase(PHASE.LONG_BREAK, settings), 900000);
});

test("durationMsForPhase falls back to work duration for an unknown phase", () => {
  const settings = { workMinutes: 25, restMinutes: 5, longBreakMinutes: 15 };
  assert.equal(durationMsForPhase("bogus", settings), 1500000);
});

test("formatTime formats minutes:seconds with zero-padding", () => {
  assert.equal(formatTime(1500000), "25:00");
  assert.equal(formatTime(65000), "1:05");
  assert.equal(formatTime(5000), "0:05");
});

test("formatTime rounds up (ceils) partial seconds so it never shows 0:00 early", () => {
  assert.equal(formatTime(500), "0:01"); // half a second left still reads as 1s
  assert.equal(formatTime(1), "0:01");
});

test("formatTime clamps negative or zero input to 0:00", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(-5000), "0:00");
});
