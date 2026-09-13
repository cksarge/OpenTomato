import { test } from "node:test";
import assert from "node:assert/strict";
import { getNextPhase } from "./phases.js";
import { PHASE } from "./constants.js";

test("work -> rest when below the cycle threshold", () => {
  const next = getNextPhase(PHASE.WORK, 0, 4);
  assert.deepEqual(next, { phase: PHASE.REST, cycleCount: 1 });
});

test("work -> long break exactly at the cycle threshold", () => {
  const next = getNextPhase(PHASE.WORK, 3, 4);
  assert.deepEqual(next, { phase: PHASE.LONG_BREAK, cycleCount: 4 });
});

test("work -> long break stays correct even if cycleCount overshoots the threshold", () => {
  // Shouldn't happen in practice, but the >= guard should hold regardless.
  const next = getNextPhase(PHASE.WORK, 10, 4);
  assert.deepEqual(next, { phase: PHASE.LONG_BREAK, cycleCount: 11 });
});

test("cyclesBeforeLongBreak of 1 sends every work session straight to a long break", () => {
  const next = getNextPhase(PHASE.WORK, 0, 1);
  assert.deepEqual(next, { phase: PHASE.LONG_BREAK, cycleCount: 1 });
});

test("rest -> work, cycle count carried through unchanged", () => {
  const next = getNextPhase(PHASE.REST, 2, 4);
  assert.deepEqual(next, { phase: PHASE.WORK, cycleCount: 2 });
});

test("long break -> work, cycle count resets to 0 for a fresh set", () => {
  const next = getNextPhase(PHASE.LONG_BREAK, 4, 4);
  assert.deepEqual(next, { phase: PHASE.WORK, cycleCount: 0 });
});
