// storage.js talks to chrome.storage.local directly, so these tests stub a
// minimal in-memory chrome global before importing it — the same shape the
// real extension gets, just backed by a plain object instead of the browser.
import { test } from "node:test";
import assert from "node:assert/strict";

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        if (typeof keys === "string") return Promise.resolve({ [keys]: store[keys] });
        const out = {};
        for (const k of keys) out[k] = store[k];
        return Promise.resolve(out);
      },
      set: (obj) => {
        Object.assign(store, obj);
        return Promise.resolve();
      },
    },
  },
};

const {
  getPresets,
  setPresets,
  getBlockingProfiles,
  setBlockingProfiles,
  getTasks,
  setTasks,
  getActiveTaskId,
  setActiveTaskId,
  sanitizeSettings,
  sanitizeStats,
} = await import("./storage.js");
const { DEFAULT_PRESETS, DEFAULT_SETTINGS } = await import("./constants.js");

test("getPresets falls back to the two built-in defaults when nothing is stored", async () => {
  const presets = await getPresets();
  assert.deepEqual(presets, DEFAULT_PRESETS);
});

test("setPresets persists an empty array as-is, not a fallback to defaults", async () => {
  await setPresets([]);
  const presets = await getPresets();
  assert.deepEqual(presets, []);
});

test("getPresets filters out malformed entries and coerces numeric fields", async () => {
  await setPresets([
    { id: "good", name: "Good One", workMinutes: "50", restMinutes: 10, cyclesBeforeLongBreak: 4, longBreakMinutes: 20 },
    { id: "missing-name" },
    "not even an object",
    null,
  ]);
  const presets = await getPresets();
  assert.deepEqual(presets, [
    { id: "good", name: "Good One", workMinutes: 50, restMinutes: 10, cyclesBeforeLongBreak: 4, longBreakMinutes: 20 },
  ]);
});

test("getBlockingProfiles defaults to an empty list when nothing is stored", async () => {
  const profiles = await getBlockingProfiles();
  assert.deepEqual(profiles, []);
});

test("getBlockingProfiles round-trips a well-formed profile", async () => {
  await setBlockingProfiles([
    { id: "deep-work", name: "Deep Work", blockMode: "blacklist", blacklist: ["reddit.com"], whitelist: [] },
  ]);
  const profiles = await getBlockingProfiles();
  assert.deepEqual(profiles, [
    { id: "deep-work", name: "Deep Work", blockMode: "blacklist", blacklist: ["reddit.com"], whitelist: [] },
  ]);
});

test("getBlockingProfiles sanitizes a bogus blockMode and non-string list entries", async () => {
  await setBlockingProfiles([
    { id: "weird", name: "Weird", blockMode: "nonsense", blacklist: ["ok.com", 5, null], whitelist: "not-an-array" },
  ]);
  const profiles = await getBlockingProfiles();
  assert.deepEqual(profiles, [
    { id: "weird", name: "Weird", blockMode: "off", blacklist: ["ok.com"], whitelist: [] },
  ]);
});

test("getTasks fills in estimate (null) and actual (0) defaults for older/plain task shapes", async () => {
  await setTasks([{ id: "t1", text: "Write report", done: false }]);
  const tasks = await getTasks();
  assert.deepEqual(tasks, [{ id: "t1", text: "Write report", done: false, estimate: null, actual: 0 }]);
});

test("getTasks round-trips estimate and actual, and rejects invalid values", async () => {
  await setTasks([
    { id: "t1", text: "Write report", done: false, estimate: "3", actual: 2 },
    { id: "t2", text: "Bad estimate", done: false, estimate: -5, actual: -1 },
  ]);
  const tasks = await getTasks();
  assert.deepEqual(tasks, [
    { id: "t1", text: "Write report", done: false, estimate: 3, actual: 2 },
    { id: "t2", text: "Bad estimate", done: false, estimate: null, actual: 0 },
  ]);
});

test("getActiveTaskId defaults to null, and round-trips a set value", async () => {
  assert.equal(await getActiveTaskId(), null);
  await setActiveTaskId("t1");
  assert.equal(await getActiveTaskId(), "t1");
  await setActiveTaskId(null);
  assert.equal(await getActiveTaskId(), null);
});

// sanitizeSettings/sanitizeStats back both the normal chrome.storage.local
// reads above and the JSON-backup importer in options.js, so an imported
// file gets exactly the same validation a live read would.
test("sanitizeSettings fills in defaults and coerces list fields for a backup file's settings", () => {
  const result = sanitizeSettings({ workMinutes: 40, blacklist: "not-an-array" });
  assert.equal(result.workMinutes, 40);
  assert.equal(result.restMinutes, DEFAULT_SETTINGS.restMinutes);
  assert.deepEqual(result.blacklist, []);
});

test("sanitizeSettings handles a missing/empty input the same as sanitizeSettings(undefined)", () => {
  assert.deepEqual(sanitizeSettings(undefined), sanitizeSettings({}));
});

test("sanitizeStats drops malformed focusLog entries and normalizes resetAt", () => {
  const result = sanitizeStats({
    focusLog: [{ end: 100, ms: 5000 }, { end: "bad" }, null, { ms: 5000 }],
    resetAt: "200",
  });
  assert.deepEqual(result.focusLog, [{ end: 100, ms: 5000 }]);
  assert.equal(result.resetAt, 200);
});
