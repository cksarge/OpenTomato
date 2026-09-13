// Thin promise-based wrapper around chrome.storage.local for the top-level
// keys OpenTomato uses. Keeping reads/writes funneled through here means every
// surface (background, popup, options, blocked page) agrees on shape/defaults.

import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMER_STATE,
  DEFAULT_STATS,
  DEFAULT_TASKS,
  DEFAULT_THEME,
  DEFAULT_PRESETS,
  DEFAULT_BLOCKING_PROFILES,
  STORAGE_KEYS,
  BLOCK_MODE,
} from "./constants.js";

// Pure sanitizers, factored out so both the normal chrome.storage.local reads
// below and the JSON-backup importer (options.js) validate a raw/untrusted
// value the exact same way.
export function sanitizeSettings(stored) {
  const settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };

  // One-time migration: older versions kept a single `blockList` shared by both
  // modes. Move it onto the list for whichever mode was active so blacklist and
  // whitelist entries stop bleeding into each other.
  if (
    Array.isArray(stored?.blockList) &&
    !Array.isArray(stored?.blacklist) &&
    !Array.isArray(stored?.whitelist)
  ) {
    const key = stored.blockMode === BLOCK_MODE.WHITELIST ? "whitelist" : "blacklist";
    settings[key] = stored.blockList.slice();
  }
  delete settings.blockList;

  settings.blacklist = Array.isArray(settings.blacklist) ? settings.blacklist.slice() : [];
  settings.whitelist = Array.isArray(settings.whitelist) ? settings.whitelist.slice() : [];
  return settings;
}

export async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: stored } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return sanitizeSettings(stored);
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function getTimerState() {
  const { [STORAGE_KEYS.TIMER_STATE]: timerState } = await chrome.storage.local.get(
    STORAGE_KEYS.TIMER_STATE
  );
  return { ...DEFAULT_TIMER_STATE, ...(timerState || {}) };
}

export async function setTimerState(timerState) {
  await chrome.storage.local.set({ [STORAGE_KEYS.TIMER_STATE]: timerState });
}

export function sanitizeStats(stored) {
  const stats = { ...DEFAULT_STATS, ...(stored || {}) };
  stats.focusLog = Array.isArray(stats.focusLog)
    ? stats.focusLog.filter(
        (entry) => entry && typeof entry.end === "number" && typeof entry.ms === "number"
      )
    : [];
  stats.resetAt = Number.isFinite(Number(stats.resetAt)) ? Number(stats.resetAt) : 0;
  return stats;
}

export async function getStats() {
  const { [STORAGE_KEYS.STATS]: stats } = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  return sanitizeStats(stats);
}

export async function setStats(stats) {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
}

// Keep only well-shaped entries so a corrupt write (or a hand-edited import
// file) can't break the UI.
export function sanitizeTasks(stored) {
  if (!Array.isArray(stored)) return DEFAULT_TASKS.slice();
  return stored
    .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
    .map((t) => ({
      id: t.id,
      text: t.text,
      done: !!t.done,
      estimate: Number.isFinite(Number(t.estimate)) && Number(t.estimate) > 0 ? Math.round(Number(t.estimate)) : null,
      actual: Number.isFinite(Number(t.actual)) && Number(t.actual) >= 0 ? Math.round(Number(t.actual)) : 0,
    }));
}

export async function getTasks() {
  const { [STORAGE_KEYS.TASKS]: tasks } = await chrome.storage.local.get(STORAGE_KEYS.TASKS);
  return sanitizeTasks(tasks);
}

export async function setTasks(tasks) {
  await chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: tasks });
}

// The task an in-progress or upcoming focus session's completed pomodoros get
// credited to (see DEFAULT_TASKS above) — null when no task is selected.
export async function getActiveTaskId() {
  const { [STORAGE_KEYS.ACTIVE_TASK]: activeTaskId } = await chrome.storage.local.get(
    STORAGE_KEYS.ACTIVE_TASK
  );
  return typeof activeTaskId === "string" ? activeTaskId : null;
}

export async function setActiveTaskId(id) {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_TASK]: id });
}

export function sanitizePresets(stored) {
  if (!Array.isArray(stored)) return DEFAULT_PRESETS.slice();
  // Keep only well-shaped entries so a corrupt write can't break the UI.
  return stored
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
    .map((p) => ({
      id: p.id,
      name: p.name,
      workMinutes: Number(p.workMinutes) || DEFAULT_SETTINGS.workMinutes,
      restMinutes: Number(p.restMinutes) || DEFAULT_SETTINGS.restMinutes,
      cyclesBeforeLongBreak: Number(p.cyclesBeforeLongBreak) || DEFAULT_SETTINGS.cyclesBeforeLongBreak,
      longBreakMinutes: Number(p.longBreakMinutes) || DEFAULT_SETTINGS.longBreakMinutes,
    }));
}

export async function getPresets() {
  const { [STORAGE_KEYS.PRESETS]: stored } = await chrome.storage.local.get(STORAGE_KEYS.PRESETS);
  return sanitizePresets(stored);
}

export async function setPresets(presets) {
  await chrome.storage.local.set({ [STORAGE_KEYS.PRESETS]: presets });
}

function sanitizeStringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

export function sanitizeBlockingProfiles(stored) {
  if (!Array.isArray(stored)) return DEFAULT_BLOCKING_PROFILES.slice();
  const validModes = [BLOCK_MODE.OFF, BLOCK_MODE.BLACKLIST, BLOCK_MODE.WHITELIST];
  return stored
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
    .map((p) => ({
      id: p.id,
      name: p.name,
      blockMode: validModes.includes(p.blockMode) ? p.blockMode : BLOCK_MODE.OFF,
      blacklist: sanitizeStringArray(p.blacklist),
      whitelist: sanitizeStringArray(p.whitelist),
    }));
}

export async function getBlockingProfiles() {
  const { [STORAGE_KEYS.BLOCKING_PROFILES]: stored } = await chrome.storage.local.get(
    STORAGE_KEYS.BLOCKING_PROFILES
  );
  return sanitizeBlockingProfiles(stored);
}

export async function setBlockingProfiles(profiles) {
  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKING_PROFILES]: profiles });
}

export async function getTheme() {
  const { [STORAGE_KEYS.THEME]: theme } = await chrome.storage.local.get(STORAGE_KEYS.THEME);
  return theme || DEFAULT_THEME;
}

export async function setTheme(theme) {
  await chrome.storage.local.set({ [STORAGE_KEYS.THEME]: theme });
}
