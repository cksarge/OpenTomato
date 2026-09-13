import {
  PHASE,
  STATUS,
  PHASE_LABELS,
  DEFAULT_SETTINGS,
  DEFAULT_TIMER_STATE,
  DEFAULT_STATS,
} from "../common/constants.js";
import { durationMsForPhase, formatTime } from "../common/duration.js";
import {
  getStats,
  getTasks,
  setTasks,
  getPresets,
  setSettings,
  getActiveTaskId,
  setActiveTaskId,
} from "../common/storage.js";
import { totalFocusMs, formatFocusDuration, STATS_WINDOW_LABELS } from "../common/stats.js";
import { initTheme } from "../common/theme.js";

const RING_RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const els = {
  card: document.getElementById("timer-card"),
  phaseLabel: document.getElementById("phase-label"),
  timeDisplay: document.getElementById("time-display"),
  ringProgress: document.getElementById("ring-progress"),
  cycleDots: document.getElementById("cycle-dots"),
  primaryBtn: document.getElementById("primary-btn"),
  skipBtn: document.getElementById("skip-btn"),
  resetBtn: document.getElementById("reset-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  restrictNote: document.getElementById("restrict-note"),
  focusStat: document.getElementById("focus-stat"),
  resetConfirm: document.getElementById("reset-confirm"),
  resetConfirmInput: document.getElementById("reset-confirm-input"),
  resetConfirmGo: document.getElementById("reset-confirm-go"),
  resetConfirmCancel: document.getElementById("reset-confirm-cancel"),
  tasks: document.getElementById("tasks"),
  taskList: document.getElementById("task-list"),
  taskToggle: document.getElementById("task-toggle"),
  presetBar: document.getElementById("preset-bar"),
  presetSelect: document.getElementById("preset-select"),
};

const RESET_PHRASE = "Yes, I want to reset the timer.";
const TASKS_PREVIEW = 3; // tasks shown before "Show all"

initTheme(els.themeToggleBtn);

let state = {
  settings: DEFAULT_SETTINGS,
  timerState: DEFAULT_TIMER_STATE,
  stats: DEFAULT_STATS,
  tasks: [],
  presets: [],
  activeTaskId: null,
};
let tasksExpanded = false;

function phaseDataAttr(phase) {
  if (phase === PHASE.REST) return "rest";
  if (phase === PHASE.LONG_BREAK) return "long-break";
  return "work";
}

function render() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const timerState = state.timerState || DEFAULT_TIMER_STATE;
  const { phase, status, cycleCount } = timerState;

  els.card.dataset.phase = phaseDataAttr(phase);

  const statusSuffix =
    status === STATUS.PAUSED ? " · Paused" : status === STATUS.IDLE ? " · Ready" : "";
  els.phaseLabel.textContent = PHASE_LABELS[phase] + statusSuffix;

  const totalMs = durationMsForPhase(phase, settings);
  let remainingMs;
  if (status === STATUS.RUNNING && timerState.phaseEndTime) {
    remainingMs = Math.max(0, timerState.phaseEndTime - Date.now());
  } else if (status === STATUS.PAUSED) {
    remainingMs = timerState.remainingMsWhenPaused ?? totalMs;
  } else {
    remainingMs = totalMs;
  }
  els.timeDisplay.textContent = formatTime(remainingMs);

  const fractionRemaining = totalMs > 0 ? remainingMs / totalMs : 0;
  els.ringProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;
  els.ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - fractionRemaining)}`;

  els.cycleDots.innerHTML = "";
  for (let i = 0; i < settings.cyclesBeforeLongBreak; i++) {
    const dot = document.createElement("span");
    const filled = phase === PHASE.LONG_BREAK || i < cycleCount;
    const active = phase === PHASE.WORK && i === cycleCount;
    dot.className = "dot" + (filled ? " filled" : "") + (active ? " active" : "");
    els.cycleDots.appendChild(dot);
  }

  if (status === STATUS.RUNNING) {
    els.primaryBtn.textContent = "Pause";
  } else if (status === STATUS.PAUSED) {
    els.primaryBtn.textContent = "Resume";
  } else {
    els.primaryBtn.textContent = "Start";
  }

  const active = status !== STATUS.IDLE;
  const restrictive = !!settings.restrictiveMode;

  // Restrictive mode: no skipping while a session runs; reset only when paused.
  els.skipBtn.disabled = !active || restrictive;
  els.resetBtn.disabled = !active || (restrictive && status !== STATUS.PAUSED);
  els.restrictNote.hidden = !(restrictive && active);

  // Close the type-to-confirm panel if a reset is no longer possible.
  if (!els.resetConfirm.hidden && !(restrictive && status === STATUS.PAUSED)) {
    closeResetConfirm();
  }

  renderFocusStat();
  renderTasks();
  renderPresetBar();
}

let lastPresetsSig = null;

function renderPresetBar() {
  const presets = Array.isArray(state.presets) ? state.presets : [];
  els.presetBar.hidden = presets.length === 0;
  if (!presets.length) return;

  // Only rebuild the <option> list when the presets actually changed, so an
  // in-progress interaction with the select isn't disturbed by render()'s
  // 250ms tick.
  const sig = JSON.stringify(presets.map((p) => [p.id, p.name]));
  if (sig !== lastPresetsSig) {
    lastPresetsSig = sig;
    els.presetSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.selected = true;
    placeholder.disabled = true;
    placeholder.textContent = "Duration preset…";
    els.presetSelect.appendChild(placeholder);
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      els.presetSelect.appendChild(option);
    }
  }

  const { settings, timerState } = state;
  els.presetSelect.disabled = !!settings.restrictiveMode && timerState.status !== STATUS.IDLE;
}

function openResetConfirm() {
  els.resetConfirmInput.value = "";
  els.resetConfirmGo.disabled = true;
  els.resetConfirm.hidden = false;
  els.resetConfirmInput.focus();
}

function closeResetConfirm() {
  els.resetConfirm.hidden = true;
}

function renderFocusStat() {
  const win = state.settings.statsWindow ?? DEFAULT_SETTINGS.statsWindow;
  const label = STATS_WINDOW_LABELS[win] ?? STATS_WINDOW_LABELS[DEFAULT_SETTINGS.statsWindow];
  const total = formatFocusDuration(totalFocusMs(state.stats, state.timerState, state.settings));
  els.focusStat.textContent = "";
  const strong = document.createElement("strong");
  strong.textContent = total;
  els.focusStat.append(`Focused ${label}: `, strong);

  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  if (tasks.length) {
    const done = tasks.filter((t) => t.done).length;
    const taskStrong = document.createElement("strong");
    taskStrong.textContent = `${done}/${tasks.length}`;
    els.focusStat.append(" · Tasks complete ", taskStrong);
  }
}

let lastTasksSig = null;

function renderTasks() {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  els.tasks.hidden = tasks.length === 0;
  if (!tasks.length) {
    lastTasksSig = "empty";
    return;
  }

  const showAll = tasksExpanded || tasks.length <= TASKS_PREVIEW;
  const visible = showAll ? tasks : tasks.slice(0, TASKS_PREVIEW);

  // render() runs every 250ms; only rebuild the interactive list when the task
  // data or the expanded state actually changed, so clicks aren't disrupted.
  const sig = JSON.stringify({
    showAll,
    activeTaskId: state.activeTaskId,
    rows: tasks.map((t) => [t.id, t.text, t.done, t.estimate, t.actual]),
  });
  if (sig === lastTasksSig) return;
  lastTasksSig = sig;

  els.taskList.innerHTML = "";
  for (const task of visible) {
    const isActive = task.id === state.activeTaskId;
    const li = document.createElement("li");
    li.className = "task-row" + (task.done ? " done" : "") + (isActive ? " active" : "");

    const label = document.createElement("label");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = task.done;
    check.addEventListener("change", () => toggleTask(task.id, check.checked));

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;
    if (task.estimate) {
      const progress = document.createElement("span");
      progress.className = "task-progress";
      progress.textContent = ` ${task.actual}/${task.estimate}`;
      text.appendChild(progress);
    }

    label.append(check, text);
    li.appendChild(label);

    const activeBtn = document.createElement("button");
    activeBtn.type = "button";
    activeBtn.className = "task-active-btn";
    activeBtn.title = isActive ? "Stop focusing on this task" : "Focus on this task";
    activeBtn.setAttribute("aria-label", activeBtn.title);
    activeBtn.setAttribute("aria-pressed", String(isActive));
    activeBtn.addEventListener("click", () => setActiveTask(task.id));
    li.appendChild(activeBtn);

    els.taskList.appendChild(li);
  }

  const overflow = tasks.length - TASKS_PREVIEW;
  if (overflow > 0) {
    els.taskToggle.hidden = false;
    els.taskToggle.textContent = tasksExpanded ? "Show less" : `Show all (${tasks.length})`;
  } else {
    els.taskToggle.hidden = true;
  }
}

// A task checked off here sinks to the bottom of the list shortly after, so
// it doesn't jump out from under the click but still settles quickly.
// Unchecking before that fires cancels the move. Only lives as long as the
// popup is open — closing it drops any pending move.
const TASK_DONE_MOVE_DELAY_MS = 500;
const pendingTaskMoves = new Map(); // task id -> setTimeout handle

async function setActiveTask(id) {
  state.activeTaskId = state.activeTaskId === id ? null : id;
  render();
  await setActiveTaskId(state.activeTaskId);
}

async function toggleTask(id, done) {
  state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done } : t));
  // A finished task has nothing left to credit pomodoros toward.
  const clearingActive = done && state.activeTaskId === id;
  if (clearingActive) state.activeTaskId = null;
  render();
  await setTasks(state.tasks);
  if (clearingActive) await setActiveTaskId(null);

  const existingTimeout = pendingTaskMoves.get(id);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    pendingTaskMoves.delete(id);
  }
  if (done) {
    pendingTaskMoves.set(
      id,
      setTimeout(() => {
        pendingTaskMoves.delete(id);
        moveTaskToBottom(id);
      }, TASK_DONE_MOVE_DELAY_MS)
    );
  }
}

async function moveTaskToBottom(id) {
  const index = state.tasks.findIndex((t) => t.id === id);
  if (index === -1) return;
  const task = state.tasks[index];
  if (!task.done) return; // unchecked again before the timer fired
  if (index === state.tasks.length - 1) return; // already last — nothing to move past

  const reordered = state.tasks.slice();
  reordered.splice(index, 1);
  reordered.push(task);
  state.tasks = reordered;
  render();
  await setTasks(state.tasks);
}

els.taskToggle.addEventListener("click", () => {
  tasksExpanded = !tasksExpanded;
  renderTasks();
});

els.presetSelect.addEventListener("change", async () => {
  const id = els.presetSelect.value;
  els.presetSelect.value = ""; // acts as a one-shot action menu, not a persistent selection
  if (!id) return;
  if (state.settings.restrictiveMode && state.timerState.status !== STATUS.IDLE) return;

  const preset = (state.presets || []).find((p) => p.id === id);
  if (!preset) return;

  state.settings = {
    ...state.settings,
    workMinutes: preset.workMinutes,
    restMinutes: preset.restMinutes,
    cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
    longBreakMinutes: preset.longBreakMinutes,
  };
  render();
  await setSettings(state.settings);
  chrome.runtime.sendMessage({ type: "opentomato:save-settings", settings: state.settings }).catch(() => {});
});

async function sendAction(type) {
  return chrome.runtime.sendMessage({ type });
}

async function loadState() {
  let response = null;
  try {
    response = await sendAction("opentomato:get-state");
  } catch {
    // Worker not ready yet (e.g. just after an unpacked reload) — fall through
    // to reading storage directly; a storage.onChanged will catch us up.
  }
  const [tasks, presets, activeTaskId] = await Promise.all([getTasks(), getPresets(), getActiveTaskId()]);

  state = {
    timerState:
      response && response.timerState ? response.timerState : state.timerState || DEFAULT_TIMER_STATE,
    settings:
      response && response.settings ? response.settings : state.settings || DEFAULT_SETTINGS,
    stats: response && response.stats ? response.stats : await getStats(),
    tasks,
    presets,
    activeTaskId,
  };
  render();
}

function applyTimerState(next) {
  if (next && typeof next === "object") state.timerState = next;
}

els.primaryBtn.addEventListener("click", async () => {
  const { status } = state.timerState;
  let type = "opentomato:start";
  if (status === STATUS.RUNNING) type = "opentomato:pause";
  else if (status === STATUS.PAUSED) type = "opentomato:resume";
  applyTimerState(await sendAction(type));
  render();
});

els.skipBtn.addEventListener("click", async () => {
  if (state.timerState.status === STATUS.IDLE) return;
  if (state.settings.restrictiveMode) return; // no skipping in restrictive mode
  applyTimerState(await sendAction("opentomato:skip"));
  render();
});

els.resetBtn.addEventListener("click", async () => {
  const { status } = state.timerState;
  if (status === STATUS.IDLE) return;

  if (state.settings.restrictiveMode) {
    if (status !== STATUS.PAUSED) return; // can only reset from a paused timer
    openResetConfirm();
    return;
  }

  applyTimerState(await sendAction("opentomato:reset"));
  render();
});

els.resetConfirmInput.addEventListener("input", () => {
  els.resetConfirmGo.disabled = els.resetConfirmInput.value !== RESET_PHRASE;
});

els.resetConfirmCancel.addEventListener("click", closeResetConfirm);

els.resetConfirmGo.addEventListener("click", async () => {
  if (els.resetConfirmInput.value !== RESET_PHRASE) return;
  closeResetConfirm();
  applyTimerState(await chrome.runtime.sendMessage({ type: "opentomato:reset", confirmed: true }));
  render();
});

els.settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.timerState) state.timerState = { ...state.timerState, ...changes.timerState.newValue };
  if (changes.settings) state.settings = { ...state.settings, ...changes.settings.newValue };
  if (changes.stats) state.stats = { ...DEFAULT_STATS, ...changes.stats.newValue };
  if (changes.tasks) {
    state.tasks = Array.isArray(changes.tasks.newValue) ? changes.tasks.newValue : [];
  }
  if (changes.presets) {
    state.presets = Array.isArray(changes.presets.newValue) ? changes.presets.newValue : [];
  }
  if (changes.activeTaskId) {
    state.activeTaskId = typeof changes.activeTaskId.newValue === "string" ? changes.activeTaskId.newValue : null;
  }
  render();
});

setInterval(render, 250);
loadState();
