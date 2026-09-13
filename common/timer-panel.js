// Reusable Pomodoro timer view + controls, backed by the background service
// worker (the same message API the popup uses). Mounts into a container
// element and stays in sync via chrome.storage.onChanged, so it agrees with
// the popup and every other surface.
//
// Used by the options page's "Timer" card. The popup keeps its own equivalent
// for now; this can be adopted there later.

import {
  PHASE,
  STATUS,
  DEFAULT_SETTINGS,
  DEFAULT_TIMER_STATE,
} from "./constants.js";
import { durationMsForPhase, formatTime } from "./duration.js";
import { t, applyI18n, phaseLabel } from "./i18n.js";

const RING_RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function resetPhrase() {
  return t("common_resetConfirmPhrase");
}

const MARKUP = `
  <div class="tp-card" data-phase="work">
    <p class="tp-phase" data-i18n="common_phaseWork">Focus</p>
    <div class="tp-ring-wrap">
      <svg class="tp-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="tp-ring-track" cx="60" cy="60" r="54"></circle>
        <circle class="tp-ring-progress" cx="60" cy="60" r="54"></circle>
      </svg>
      <div class="tp-time">25:00</div>
    </div>
    <div class="tp-dots" aria-hidden="true"></div>
    <div class="tp-controls">
      <button type="button" class="btn btn-primary tp-primary" data-i18n="common_start">Start</button>
      <div class="tp-secondary">
        <button type="button" class="btn btn-ghost tp-skip" data-i18n="common_skip" disabled>Skip</button>
        <button type="button" class="btn btn-ghost tp-reset" data-i18n="common_reset" disabled>Reset</button>
      </div>
    </div>
    <p class="tp-restrict-note" data-i18n="common_restrictNote" hidden>🔒 Restrictive mode — no skipping; reset only while paused.</p>
    <div class="tp-reset-confirm" hidden>
      <p data-i18n="common_resetConfirmPrompt">Restrictive mode is on. To reset the timer, type this exactly:</p>
      <p class="tp-reset-phrase" data-i18n="common_resetConfirmPhrase">Yes, I want to reset the timer.</p>
      <input type="text" class="tp-reset-input" data-i18n-placeholder="common_resetConfirmPlaceholder" placeholder="Type the phrase"
             autocomplete="off" autocapitalize="off" spellcheck="false" />
      <div class="tp-reset-actions">
        <button type="button" class="btn btn-ghost tp-reset-cancel" data-i18n="common_cancel">Cancel</button>
        <button type="button" class="btn btn-primary tp-reset-go" data-i18n="common_resetTimer" disabled>Reset timer</button>
      </div>
    </div>
  </div>
`;

function phaseAttr(phase) {
  if (phase === PHASE.REST) return "rest";
  if (phase === PHASE.LONG_BREAK) return "long-break";
  return "work";
}

export function initTimerPanel(root) {
  if (!root) return;
  root.innerHTML = MARKUP;
  applyI18n(root);

  const els = {
    card: root.querySelector(".tp-card"),
    phase: root.querySelector(".tp-phase"),
    time: root.querySelector(".tp-time"),
    ring: root.querySelector(".tp-ring-progress"),
    dots: root.querySelector(".tp-dots"),
    primary: root.querySelector(".tp-primary"),
    skip: root.querySelector(".tp-skip"),
    reset: root.querySelector(".tp-reset"),
    restrictNote: root.querySelector(".tp-restrict-note"),
    resetConfirm: root.querySelector(".tp-reset-confirm"),
    resetInput: root.querySelector(".tp-reset-input"),
    resetGo: root.querySelector(".tp-reset-go"),
    resetCancel: root.querySelector(".tp-reset-cancel"),
  };

  let state = {
    settings: { ...DEFAULT_SETTINGS },
    timerState: { ...DEFAULT_TIMER_STATE },
  };

  function render() {
    const settings = state.settings || DEFAULT_SETTINGS;
    const timerState = state.timerState || DEFAULT_TIMER_STATE;
    const { phase, status, cycleCount } = timerState;

    els.card.dataset.phase = phaseAttr(phase);

    const statusWord =
      status === STATUS.PAUSED ? t("common_statusPaused") : status === STATUS.IDLE ? t("common_statusReady") : "";
    els.phase.textContent = statusWord ? t("common_phaseWithStatus", [phaseLabel(phase), statusWord]) : phaseLabel(phase);

    const totalMs = durationMsForPhase(phase, settings);
    let remainingMs;
    if (status === STATUS.RUNNING && timerState.phaseEndTime) {
      remainingMs = Math.max(0, timerState.phaseEndTime - Date.now());
    } else if (status === STATUS.PAUSED) {
      remainingMs = timerState.remainingMsWhenPaused ?? totalMs;
    } else {
      remainingMs = totalMs;
    }
    els.time.textContent = formatTime(remainingMs);

    const fractionRemaining = totalMs > 0 ? remainingMs / totalMs : 0;
    els.ring.style.strokeDasharray = `${CIRCUMFERENCE}`;
    els.ring.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - fractionRemaining)}`;

    els.dots.innerHTML = "";
    const cycles = Math.max(1, Number(settings.cyclesBeforeLongBreak) || 1);
    for (let i = 0; i < cycles; i++) {
      const dot = document.createElement("span");
      const filled = phase === PHASE.LONG_BREAK || i < cycleCount;
      const active = phase === PHASE.WORK && i === cycleCount;
      dot.className = "tp-dot" + (filled ? " filled" : "") + (active ? " active" : "");
      els.dots.appendChild(dot);
    }

    els.primary.textContent =
      status === STATUS.RUNNING ? t("common_pause") : status === STATUS.PAUSED ? t("common_resume") : t("common_start");

    const running = status !== STATUS.IDLE;
    const restrictive = !!settings.restrictiveMode;
    els.skip.disabled = !running || restrictive;
    els.reset.disabled = !running || (restrictive && status !== STATUS.PAUSED);
    els.restrictNote.hidden = !(restrictive && running);

    if (!els.resetConfirm.hidden && !(restrictive && status === STATUS.PAUSED)) {
      closeResetConfirm();
    }
  }

  function openResetConfirm() {
    els.resetInput.value = "";
    els.resetGo.disabled = true;
    els.resetConfirm.hidden = false;
    els.resetInput.focus();
  }

  function closeResetConfirm() {
    els.resetConfirm.hidden = true;
  }

  async function send(type, extra) {
    return chrome.runtime.sendMessage({ type, ...(extra || {}) });
  }

  async function loadState() {
    const res = await send("opentomato:get-state");
    if (res) {
      if (res.timerState) state.timerState = res.timerState;
      if (res.settings) state.settings = res.settings;
    }
    render();
  }

  els.primary.addEventListener("click", async () => {
    const s = state.timerState.status;
    const type =
      s === STATUS.RUNNING
        ? "opentomato:pause"
        : s === STATUS.PAUSED
        ? "opentomato:resume"
        : "opentomato:start";
    const res = await send(type);
    if (res) state.timerState = res;
    render();
  });

  els.skip.addEventListener("click", async () => {
    if (state.timerState.status === STATUS.IDLE) return;
    if (state.settings.restrictiveMode) return;
    const res = await send("opentomato:skip");
    if (res) state.timerState = res;
    render();
  });

  els.reset.addEventListener("click", async () => {
    const s = state.timerState.status;
    if (s === STATUS.IDLE) return;
    if (state.settings.restrictiveMode) {
      if (s !== STATUS.PAUSED) return;
      openResetConfirm();
      return;
    }
    const res = await send("opentomato:reset");
    if (res) state.timerState = res;
    render();
  });

  els.resetInput.addEventListener("input", () => {
    els.resetGo.disabled = els.resetInput.value !== resetPhrase();
  });
  els.resetCancel.addEventListener("click", closeResetConfirm);
  els.resetGo.addEventListener("click", async () => {
    if (els.resetInput.value !== resetPhrase()) return;
    closeResetConfirm();
    const res = await send("opentomato:reset", { confirmed: true });
    if (res) state.timerState = res;
    render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.timerState) {
      state.timerState = { ...DEFAULT_TIMER_STATE, ...(changes.timerState.newValue || {}) };
    }
    if (changes.settings) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    }
    render();
  });

  setInterval(render, 250);
  loadState();
}
