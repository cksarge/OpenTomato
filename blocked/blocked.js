// This page lives at chrome-extension://<id>/blocked/blocked.html, so it can
// read extension storage directly (no messaging round-trip needed).

import { PHASE, STATUS, DEFAULT_SETTINGS } from "../common/constants.js";
import { getSettings, getTimerState } from "../common/storage.js";
import { formatTime } from "../common/duration.js";
import { initTheme } from "../common/theme.js";
import { t, applyI18n } from "../common/i18n.js";

applyI18n();

const els = {
  card: document.getElementById("card"),
  icon: document.querySelector(".icon"),
  headline: document.getElementById("headline"),
  message: document.getElementById("message"),
  hint: document.getElementById("hint"),
  timeValue: document.getElementById("time-value"),
  actions: document.getElementById("actions"),
  backBtn: document.getElementById("back-btn"),
  continueBtn: document.getElementById("continue-btn"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
};

initTheme(els.themeToggleBtn);

// The address the user was heading to, handed over by the background worker.
// Only trust http(s) URLs — never navigate to anything else from here.
const originalUrl = (() => {
  const raw = new URLSearchParams(location.search).get("url");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
})();

const originalHost = originalUrl ? new URL(originalUrl).hostname.replace(/^www\./, "") : null;

let timerState = null;
let settings = { ...DEFAULT_SETTINGS };

function render() {
  if (!timerState) return;
  const isBlocking = timerState.status === STATUS.RUNNING && timerState.phase === PHASE.WORK;

  els.card.classList.toggle("free", !isBlocking);

  if (isBlocking) {
    els.icon.textContent = "⛔";
    els.headline.textContent = t("blocked_headline");
    els.message.textContent = t("blocked_message");
    els.hint.textContent = t("blocked_hint");
    els.hint.hidden = false;
    const remainingMs = Math.max(0, (timerState.phaseEndTime ?? Date.now()) - Date.now());
    els.timeValue.textContent = formatTime(remainingMs);

    els.backBtn.hidden = true;
    // "Continue anyway" is off the table in restrictive mode.
    els.continueBtn.hidden = !originalUrl || settings.restrictiveMode;
  } else {
    els.icon.textContent = "✅";
    els.headline.textContent = t("blocked_headlineFree");
    els.message.textContent = t("blocked_messageFree");
    els.hint.hidden = true;
    els.timeValue.textContent = "--:--";

    els.continueBtn.hidden = true;
    if (originalUrl) {
      els.backBtn.textContent = originalHost ? t("blocked_backToHost", [originalHost]) : t("blocked_backToSite");
      els.backBtn.hidden = false;
    } else {
      els.backBtn.hidden = true;
    }
  }

  els.actions.hidden = els.backBtn.hidden && els.continueBtn.hidden;
}

els.backBtn.addEventListener("click", () => {
  if (originalUrl) window.location.replace(originalUrl);
});

els.continueBtn.addEventListener("click", async () => {
  if (!originalUrl) return;
  els.continueBtn.disabled = true;
  const res = await chrome.runtime
    .sendMessage({ type: "opentomato:continue-anyway", url: originalUrl })
    .catch(() => null);
  if (res && res.ok) {
    window.location.replace(originalUrl);
  } else {
    els.continueBtn.disabled = false;
    render();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.timerState) timerState = { ...timerState, ...changes.timerState.newValue };
  if (changes.settings) settings = { ...settings, ...changes.settings.newValue };
  render();
});

(async function init() {
  [settings, timerState] = await Promise.all([getSettings(), getTimerState()]);
  render();
  setInterval(render, 1000);
})();
