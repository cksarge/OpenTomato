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

const { getPresets, setPresets, getBlockingProfiles, setBlockingProfiles } = await import("./storage.js");
const { DEFAULT_PRESETS } = await import("./constants.js");

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
