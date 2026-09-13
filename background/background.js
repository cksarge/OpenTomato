// OpenTomato background service worker (MV3, type: module).
//
// This worker is ephemeral — Chrome can unload it at any time between events.
// Because of that, the timer's source of truth is chrome.storage.local
// (see common/storage.js) plus chrome.alarms for waking the worker back up
// at the right moments. Nothing here relies on setInterval/setTimeout to
// track elapsed time.

import {
  PHASE,
  STATUS,
  BLOCK_MODE,
  DEFAULT_TIMER_STATE,
  ALARM_PHASE_END,
  ALARM_WARNING,
  ALARM_BADGE_TICK,
} from "../common/constants.js";
import {
  getSettings,
  setSettings,
  getTimerState,
  setTimerState,
  getStats,
  setStats,
  getTasks,
  setTasks,
  getActiveTaskId,
} from "../common/storage.js";
import { isUrlBlocked, activeBlockList, matchesList } from "../common/blocklist.js";
import { t, phaseLabel } from "../common/i18n.js";
import { getNextPhase } from "../common/phases.js";
import { durationMsForPhase } from "../common/duration.js";

const BLOCKED_URL = chrome.runtime.getURL("blocked/blocked.html");

// The blocked page gets the address the user was heading to, so it can offer
// "Continue anyway" and (once the session ends) a "Back to <site>" link.
function blockedUrlFor(originalUrl) {
  return `${BLOCKED_URL}?url=${encodeURIComponent(originalUrl || "")}`;
}

// "Continue anyway" allow-list: { [tabId]: [hostname, ...] }. Kept in
// chrome.storage.session (in-memory, survives worker restarts, gone when the
// browser closes). Cleared per-tab on close and wholesale on a new session.
async function getBypass() {
  const { bypass } = await chrome.storage.session.get("bypass");
  return bypass && typeof bypass === "object" ? bypass : {};
}

async function addBypass(tabId, hostname) {
  const bypass = await getBypass();
  const hosts = new Set(bypass[tabId] || []);
  hosts.add(hostname);
  bypass[tabId] = [...hosts];
  await chrome.storage.session.set({ bypass });
}

async function clearBypass(tabId) {
  if (tabId == null) {
    await chrome.storage.session.set({ bypass: {} });
    return;
  }
  const bypass = await getBypass();
  if (bypass[tabId]) {
    delete bypass[tabId];
    await chrome.storage.session.set({ bypass });
  }
}

async function isBypassed(tabId, url) {
  if (tabId == null) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  const bypass = await getBypass();
  return matchesList(hostname, bypass[tabId] || []);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clearBypass(tabId);
});

// Toolbar badge: shows minutes remaining in the current phase (like uBlock's
// blocked-count badge, but counting down instead of up), color-coded to
// match the popup's phase colors so it's readable at a glance without
// opening anything. In the final minute it switches to a per-second countdown
// ("45s"), driven by a 1s interval since chrome.alarms can't tick that fast.
const BADGE_COLORS = {
  [PHASE.WORK]: "#e85c41",
  [PHASE.REST]: "#3fa66b",
  [PHASE.LONG_BREAK]: "#3f7fd1",
};
const BADGE_PAUSED_COLOR = "#8a7a6e";

let badgeSecondTimer = null;

function ensureBadgeSecondTimer() {
  if (badgeSecondTimer === null) {
    badgeSecondTimer = setInterval(refreshBadge, 1000);
  }
}

function stopBadgeSecondTimer() {
  if (badgeSecondTimer !== null) {
    clearInterval(badgeSecondTimer);
    badgeSecondTimer = null;
  }
}

// While a phase is actively counting down, keep the service worker resident.
// MV3 unloads the worker after ~30s idle; if that happens mid-phase the badge
// freezes on whatever it last showed and only corrects on the next event that
// wakes the worker (a delayed alarm, a navigation, opening the popup), so it
// visibly drifts from the real time left. A sub-30s interval that calls a
// chrome API each tick keeps the worker alive for the duration of a running
// phase, and re-derives the badge straight from phaseEndTime every tick so it
// can't get stale. Runs only while RUNNING with the countdown badge enabled —
// paused and idle timers let the worker sleep as normal.
let keepAliveTimer = null;

function startKeepAlive() {
  if (keepAliveTimer === null) {
    keepAliveTimer = setInterval(refreshBadge, 20000);
  }
}

function stopKeepAlive() {
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  // Reading then writing back through getSettings/getTimerState fills in any
  // missing defaults, so storage always has a complete, well-shaped record.
  const settings = await getSettings();
  await setSettings(settings);
  await setTimerState(await getTimerState());
  await applyIdleDetectionInterval(settings);
});

async function refreshBadge() {
  const timerState = await getTimerState();
  const settings = await getSettings();

  // The minutes-remaining countdown badge is opt-out via the Notifications
  // settings; when disabled, keep the toolbar icon clean.
  if (!settings.badgeCountdown) {
    stopBadgeSecondTimer();
    stopKeepAlive();
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  let remainingMs;
  if (timerState.status === STATUS.RUNNING && timerState.phaseEndTime) {
    remainingMs = Math.max(0, timerState.phaseEndTime - Date.now());
  } else if (timerState.status === STATUS.PAUSED) {
    remainingMs = Math.max(0, timerState.remainingMsWhenPaused ?? 0);
  } else {
    stopBadgeSecondTimer();
    stopKeepAlive();
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  // Keep the worker alive while the timer runs so the countdown can't freeze;
  // let it sleep while paused (the badge holds a static value then anyway).
  if (timerState.status === STATUS.RUNNING) startKeepAlive();
  else stopKeepAlive();

  // Under a minute left: show a live seconds countdown instead of a flat "1".
  const underOneMinute = remainingMs > 0 && remainingMs < 60000;
  if (timerState.status === STATUS.RUNNING && underOneMinute) {
    ensureBadgeSecondTimer();
  } else {
    stopBadgeSecondTimer();
  }

  const text = underOneMinute
    ? t("notify_badgeSeconds", [String(Math.ceil(remainingMs / 1000))])
    : t("notify_badgeMinutes", [String(Math.ceil(remainingMs / 60000))]);
  const color =
    timerState.status === STATUS.PAUSED ? BADGE_PAUSED_COLOR : BADGE_COLORS[timerState.phase] ?? BADGE_COLORS[PHASE.WORK];

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  // Older Chrome versions don't have setBadgeTextColor; badge text defaults
  // to white anyway, but set it explicitly where available for reliability.
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  }
}

// Refresh on every service-worker wake-up (message, alarm, install, etc.) so
// the badge is never stale even if a tick alarm was ever missed/delayed.
// Also (re-)applies the idle detection interval, since a fresh worker can't
// assume Chrome remembered a value set by a previous, since-unloaded one.
refreshBadge();
getSettings().then(applyIdleDetectionInterval);

// Storage changes are a reliable wake-up even when the "save-settings" message
// doesn't reach a sleeping worker, so mirror any settings edit onto the badge
// (and the idle detection interval) right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  refreshBadge();
  applyIdleDetectionInterval(changes.settings.newValue || {});
});

// Idle detection: auto-pause a running timer when the computer has been idle
// (or locked) for the configured number of minutes, so walking away doesn't
// silently burn through a session or inflate the focus total. Off by default
// (settings.idleEnabled). Whether coming back auto-resumes or just leaves it
// paused is itself a setting (settings.idleAutoResume).
//
// "Was this pause caused by idle detection?" is tracked in chrome.storage.session
// (in-memory, survives worker restarts, gone when the browser closes) rather
// than timerState, so it never gets confused with — or has to be cleaned up
// by — a manual pause. Only a RUNNING -> PAUSED transition triggered here sets
// the flag, so a session the user paused themselves before going idle is never
// auto-resumed out from under them.
async function getIdleAutoPaused() {
  const { idleAutoPaused } = await chrome.storage.session.get("idleAutoPaused");
  return idleAutoPaused === true;
}

async function setIdleAutoPaused(value) {
  await chrome.storage.session.set({ idleAutoPaused: value });
}

async function applyIdleDetectionInterval(settings) {
  // chrome.idle takes seconds and clamps below 15 itself; idleMinutes is
  // already kept to a sane range (1-30) by the options page.
  const minutes = Math.max(1, Number(settings.idleMinutes) || 1);
  chrome.idle.setDetectionInterval(minutes * 60);
}

chrome.idle.onStateChanged.addListener(async (state) => {
  const settings = await getSettings();
  if (!settings.idleEnabled) return;

  if (state === "idle" || state === "locked") {
    const timerState = await getTimerState();
    if (timerState.status !== STATUS.RUNNING) return; // nothing running to protect
    await pauseTimer();
    await setIdleAutoPaused(true);
    notify(t("appShortName"), t("notify_idlePaused"));
    return;
  }

  if (state === "active") {
    if (!(await getIdleAutoPaused())) return; // this return wasn't from an idle-triggered pause
    await setIdleAutoPaused(false);
    if (settings.idleAutoResume) {
      const resumed = await resumeTimer();
      if (resumed.status === STATUS.RUNNING) {
        notify(t("appShortName"), t("notify_idleResumed"));
      }
    }
  }
});

const FOCUS_LOG_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000; // keep ~1.5 months of history
const MIN_FOCUS_SEGMENT_MS = 30 * 1000; // ignore blink-and-you-miss-it stretches

// Log how much of a focus (WORK) phase was actually spent before it ended —
// whether it ran out naturally, was skipped, or was reset. Called with the
// timer state as it was *before* the transition. Returns whether it logged
// anything, so callers can tell a real stretch of focus from a near-instant
// one (e.g. immediately skipping or resetting).
async function recordFocusSegment(timerState, settings) {
  if (timerState.phase !== PHASE.WORK) return false;

  const fullMs = durationMsForPhase(PHASE.WORK, settings);
  let elapsedMs = 0;
  if (timerState.status === STATUS.RUNNING && timerState.phaseEndTime) {
    elapsedMs = fullMs - Math.max(0, timerState.phaseEndTime - Date.now());
  } else if (timerState.status === STATUS.PAUSED) {
    elapsedMs = fullMs - Math.max(0, timerState.remainingMsWhenPaused ?? fullMs);
  }
  elapsedMs = Math.max(0, Math.min(fullMs, elapsedMs));
  if (elapsedMs < MIN_FOCUS_SEGMENT_MS) return false;

  const stats = await getStats();
  const now = Date.now();
  const cutoff = now - FOCUS_LOG_MAX_AGE_MS;
  const focusLog = [
    ...(Array.isArray(stats.focusLog) ? stats.focusLog : []).filter(
      (entry) => entry && typeof entry.end === "number" && entry.end >= cutoff
    ),
    { end: now, ms: Math.round(elapsedMs) },
  ];
  await setStats({ ...stats, focusLog });
  return true;
}

// Credits the currently-selected "active" task with one completed pomodoro.
// Only called when a WORK phase actually transitions to a break (naturally or
// via skip) — not on reset, which represents abandoning the attempt rather
// than finishing it.
async function incrementActiveTaskProgress() {
  const activeTaskId = await getActiveTaskId();
  if (!activeTaskId) return;
  const tasks = await getTasks();
  const index = tasks.findIndex((t) => t.id === activeTaskId);
  if (index === -1) return;
  tasks[index] = { ...tasks[index], actual: tasks[index].actual + 1 };
  await setTasks(tasks);
}

async function clearAlarms() {
  await chrome.alarms.clear(ALARM_PHASE_END);
  await chrome.alarms.clear(ALARM_WARNING);
  await chrome.alarms.clear(ALARM_BADGE_TICK);
}

async function scheduleAlarms(timerState, settings) {
  await clearAlarms();
  if (timerState.status !== STATUS.RUNNING || !timerState.phaseEndTime) return;

  chrome.alarms.create(ALARM_PHASE_END, { when: timerState.phaseEndTime });
  // Chrome clamps alarm periods to a 1-minute minimum, which conveniently
  // matches the badge's minute-level resolution. Skip it entirely when the
  // countdown badge is turned off so nothing keeps redrawing the icon.
  if (settings.badgeCountdown) {
    chrome.alarms.create(ALARM_BADGE_TICK, { delayInMinutes: 1, periodInMinutes: 1 });
  }

  if (settings.warningEnabled && settings.warningSeconds > 0) {
    const warnAt = timerState.phaseEndTime - settings.warningSeconds * 1000;
    if (warnAt > Date.now()) {
      chrome.alarms.create(ALARM_WARNING, { when: warnAt });
    }
  }
}

async function playSound(kind) {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: "offscreen/offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play a short alert tone for Pomodoro phase changes.",
      });
    }
    chrome.runtime.sendMessage({ type: "opentomato:play-sound", kind }).catch(() => {});
  } catch (err) {
    console.error("OpenTomato: failed to play sound", err);
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
    priority: 1,
  });
}

async function sweepTabsForBlocking(settings) {
  if (settings.blockMode === BLOCK_MODE.OFF) return;
  const tabs = await chrome.tabs.query({});
  const list = activeBlockList(settings);
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (await isBypassed(tab.id, tab.url)) continue;
    if (isUrlBlocked(tab.url, settings.blockMode, list)) {
      chrome.tabs.update(tab.id, { url: blockedUrlFor(tab.url) });
    }
  }
}

async function applyState(timerState, settings, { sweep = false } = {}) {
  await setTimerState(timerState);
  await scheduleAlarms(timerState, settings);
  await refreshBadge();
  if (sweep && timerState.status === STATUS.RUNNING && timerState.phase === PHASE.WORK) {
    await sweepTabsForBlocking(settings);
  }
}

async function startTimer() {
  const settings = await getSettings();
  // A brand-new session wipes any "continue anyway" allowances from before.
  await clearBypass(null);
  const timerState = {
    status: STATUS.RUNNING,
    phase: PHASE.WORK,
    cycleCount: 0,
    phaseEndTime: Date.now() + durationMsForPhase(PHASE.WORK, settings),
    remainingMsWhenPaused: null,
  };
  await applyState(timerState, settings, { sweep: true });
  return timerState;
}

async function pauseTimer() {
  const settings = await getSettings();
  const timerState = await getTimerState();
  if (timerState.status !== STATUS.RUNNING) return timerState;

  const remaining = Math.max(0, timerState.phaseEndTime - Date.now());
  const next = {
    ...timerState,
    status: STATUS.PAUSED,
    remainingMsWhenPaused: remaining,
    phaseEndTime: null,
  };
  await applyState(next, settings);
  return next;
}

async function resumeTimer() {
  const settings = await getSettings();
  const timerState = await getTimerState();
  if (timerState.status !== STATUS.PAUSED) return timerState;

  const remaining = timerState.remainingMsWhenPaused ?? durationMsForPhase(timerState.phase, settings);
  const next = {
    ...timerState,
    status: STATUS.RUNNING,
    phaseEndTime: Date.now() + remaining,
    remainingMsWhenPaused: null,
  };
  await applyState(next, settings, { sweep: true });
  return next;
}

async function resetTimer() {
  const settings = await getSettings();
  await recordFocusSegment(await getTimerState(), settings);
  await clearBypass(null);
  const next = { ...DEFAULT_TIMER_STATE };
  await applyState(next, settings);
  return next;
}

async function advancePhase({ announce }) {
  const settings = await getSettings();
  const timerState = await getTimerState();
  const finishedPhase = timerState.phase;
  const counted = await recordFocusSegment(timerState, settings);
  if (counted) await incrementActiveTaskProgress();
  const { phase: nextPhase, cycleCount } = getNextPhase(
    finishedPhase,
    timerState.cycleCount,
    settings.cyclesBeforeLongBreak
  );

  const next = {
    status: STATUS.RUNNING,
    phase: nextPhase,
    cycleCount,
    phaseEndTime: Date.now() + durationMsForPhase(nextPhase, settings),
    remainingMsWhenPaused: null,
  };
  await applyState(next, settings, { sweep: true });

  if (announce) {
    notify(t("appShortName"), t("notify_phaseFinished", [phaseLabel(finishedPhase), phaseLabel(nextPhase)]));
    if (settings.soundOnEnd) await playSound("end");
  }
  return next;
}

async function skipPhase() {
  return advancePhase({ announce: false });
}

// Keyboard shortcut (chrome.commands, rebindable at chrome://extensions/shortcuts):
// mirrors the popup's primary button — start if idle, pause if running, resume
// if paused — so it does the one obviously-right thing without a popup open.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-timer") return;
  const timerState = await getTimerState();
  if (timerState.status === STATUS.RUNNING) await pauseTimer();
  else if (timerState.status === STATUS.PAUSED) await resumeTimer();
  else await startTimer();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_PHASE_END) {
    await advancePhase({ announce: true });
  } else if (alarm.name === ALARM_WARNING) {
    const settings = await getSettings();
    const timerState = await getTimerState();
    if (settings.soundOnWarning) await playSound("warning");
    notify(t("appShortName"), t("notify_warning", [String(settings.warningSeconds), phaseLabel(timerState.phase)]));
    await refreshBadge();
  } else if (alarm.name === ALARM_BADGE_TICK) {
    await refreshBadge();
  }
});

// Fields that restrictive mode freezes once a focus session is running.
const RESTRICTED_SETTING_KEYS = [
  "restrictiveMode",
  "workMinutes",
  "restMinutes",
  "cyclesBeforeLongBreak",
  "longBreakMinutes",
  "blockMode",
  "blacklist",
  "whitelist",
  "idleEnabled",
  "idleMinutes",
  "idleAutoResume",
];

function restrictionsActive(settings, timerState) {
  return settings.restrictiveMode && timerState.status !== STATUS.IDLE;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || !message.type.startsWith("opentomato:")) {
    return false; // not for us (e.g. offscreen-targeted messages) — let others handle it
  }

  (async () => {
    switch (message.type) {
      case "opentomato:start":
        sendResponse(await startTimer());
        break;
      case "opentomato:pause":
        sendResponse(await pauseTimer());
        break;
      case "opentomato:resume":
        sendResponse(await resumeTimer());
        break;
      case "opentomato:reset": {
        const settings = await getSettings();
        const timerState = await getTimerState();
        if (restrictionsActive(settings, timerState)) {
          // Restrictive mode: only from a paused timer, and only with the typed
          // confirmation the popup collects.
          if (timerState.status !== STATUS.PAUSED || message.confirmed !== true) {
            sendResponse(timerState);
            break;
          }
        }
        sendResponse(await resetTimer());
        break;
      }
      case "opentomato:skip": {
        const settings = await getSettings();
        const timerState = await getTimerState();
        if (restrictionsActive(settings, timerState)) {
          sendResponse(timerState); // no skipping, no matter what
          break;
        }
        sendResponse(await skipPhase());
        break;
      }
      case "opentomato:continue-anyway": {
        const settings = await getSettings();
        const timerState = await getTimerState();
        // Disabled entirely in restrictive mode; otherwise only meaningful while
        // a focus block is actually in effect.
        if (
          settings.restrictiveMode ||
          timerState.status !== STATUS.RUNNING ||
          timerState.phase !== PHASE.WORK
        ) {
          sendResponse({ ok: false });
          break;
        }
        const tabId = sender.tab?.id;
        let hostname = null;
        try {
          hostname = new URL(message.url).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          hostname = null;
        }
        if (tabId == null || !hostname) {
          sendResponse({ ok: false });
          break;
        }
        await addBypass(tabId, hostname);
        sendResponse({ ok: true });
        break;
      }
      case "opentomato:get-state":
        sendResponse({
          timerState: await getTimerState(),
          settings: await getSettings(),
          stats: await getStats(),
        });
        break;
      case "opentomato:reset-stats":
        await setStats({ focusLog: [], resetAt: Date.now() });
        sendResponse({ ok: true });
        break;
      case "opentomato:save-settings": {
        const current = await getSettings();
        const timerState = await getTimerState();
        let incoming = message.settings || {};
        if (restrictionsActive(current, timerState)) {
          // Ignore edits to any frozen field (defends against a stale options
          // page or a second tab writing while the session is locked).
          incoming = { ...incoming };
          for (const key of RESTRICTED_SETTING_KEYS) incoming[key] = current[key];
        }
        await setSettings(incoming);
        // Re-schedule alarms in case warning/duration settings changed mid-run.
        await scheduleAlarms(await getTimerState(), incoming);
        if (!incoming.badgeCountdown) {
          stopBadgeSecondTimer();
          await chrome.action.setBadgeText({ text: "" });
        }
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse(null);
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // main-frame navigations only

  const settings = await getSettings();
  if (settings.blockMode === BLOCK_MODE.OFF) return;

  const timerState = await getTimerState();
  if (timerState.status !== STATUS.RUNNING || timerState.phase !== PHASE.WORK) return;

  if (await isBypassed(details.tabId, details.url)) return;

  if (isUrlBlocked(details.url, settings.blockMode, activeBlockList(settings))) {
    chrome.tabs.update(details.tabId, { url: blockedUrlFor(details.url) });
  }
});
