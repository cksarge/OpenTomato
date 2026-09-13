// Thin helper around chrome.i18n for the static markup in each page's HTML.
// Dynamically-built elements (rendered from JS, e.g. task rows) call
// chrome.i18n.getMessage() directly instead of using these attributes.
//
// Supported attributes, applied to every matching element under `root`:
//   data-i18n               -> element.textContent
//   data-i18n-placeholder    -> element.placeholder
//   data-i18n-title          -> element.title
//   data-i18n-aria-label     -> element.setAttribute("aria-label", ...)
//
// A handful of hint strings need an inline styled span (e.g. <code>, <em>)
// — those aren't covered by data-i18n (which only ever sets textContent) and
// instead call applyI18nHtml() directly; see its own doc comment below.

import { PHASE, STATS_WINDOW } from "./constants.js";

export function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || "";
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = t(el.getAttribute("data-i18n"));
    if (msg) el.textContent = msg;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const msg = t(el.getAttribute("data-i18n-placeholder"));
    if (msg) el.placeholder = msg;
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const msg = t(el.getAttribute("data-i18n-title"));
    if (msg) el.title = msg;
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const msg = t(el.getAttribute("data-i18n-aria-label"));
    if (msg) el.setAttribute("aria-label", msg);
  });
}

// For the handful of hint strings that need an inline styled span (e.g.
// <code>example.com</code> or <em>paused</em>) — a small, fixed set of
// messages.json entries that intentionally contain literal HTML written by
// us/translators, never anything from a user or a remote page. Everywhere
// else, prefer data-i18n (textContent) over this.
export function applyI18nHtml(el, key) {
  const html = t(key);
  if (html) el.innerHTML = html;
}

const PHASE_LABEL_KEYS = {
  [PHASE.WORK]: "common_phaseWork",
  [PHASE.REST]: "common_phaseRest",
  [PHASE.LONG_BREAK]: "common_phaseLongBreak",
};

export function phaseLabel(phase) {
  return t(PHASE_LABEL_KEYS[phase] ?? PHASE_LABEL_KEYS[PHASE.WORK]);
}

const STATS_WINDOW_LABEL_KEYS = {
  [STATS_WINDOW.HOUR]: "common_statsWindowHour",
  [STATS_WINDOW.DAY]: "common_statsWindowDay",
  [STATS_WINDOW.WEEK]: "common_statsWindowWeek",
  [STATS_WINDOW.MONTH]: "common_statsWindowMonth",
  [STATS_WINDOW.ALL]: "common_statsWindowAll",
};

export function statsWindowLabel(window) {
  return t(STATS_WINDOW_LABEL_KEYS[window] ?? STATS_WINDOW_LABEL_KEYS[STATS_WINDOW.DAY]);
}
