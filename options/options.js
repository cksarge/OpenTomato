import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  DEFAULT_TIMER_STATE,
  BLOCK_MODE,
  STATUS,
  SITE_FOLDERS,
} from "../common/constants.js";
import {
  getSettings,
  setSettings,
  sanitizeSettings,
  getStats,
  setStats,
  sanitizeStats,
  getTimerState,
  getTasks,
  setTasks,
  sanitizeTasks,
  getPresets,
  setPresets,
  sanitizePresets,
  getBlockingProfiles,
  setBlockingProfiles,
  sanitizeBlockingProfiles,
  getActiveTaskId,
  setActiveTaskId,
  getTheme,
  setTheme,
} from "../common/storage.js";
import { normalizeEntry } from "../common/blocklist.js";
import { totalFocusMs, formatFocusDuration } from "../common/stats.js";
import { initTheme } from "../common/theme.js";
import { initTimerPanel } from "../common/timer-panel.js";
import { t, applyI18n, applyI18nHtml, statsWindowLabel } from "../common/i18n.js";

applyI18n();
applyI18nHtml(document.getElementById("restrictive-bullet-3"), "options_restrictiveBullet3");
applyI18nHtml(document.getElementById("blocking-hint"), "options_blockingHint");

const els = {
  restrictiveMode: document.getElementById("restrictiveMode"),
  restrictiveActiveNote: document.getElementById("restrictive-active-note"),
  timerLockNote: document.getElementById("timer-lock-note"),
  blockingLockNote: document.getElementById("blocking-lock-note"),
  idleLockNote: document.getElementById("idle-lock-note"),
  workMinutes: document.getElementById("workMinutes"),
  restMinutes: document.getElementById("restMinutes"),
  cyclesBeforeLongBreak: document.getElementById("cyclesBeforeLongBreak"),
  longBreakMinutes: document.getElementById("longBreakMinutes"),
  soundOnEnd: document.getElementById("soundOnEnd"),
  badgeCountdown: document.getElementById("badgeCountdown"),
  warningEnabled: document.getElementById("warningEnabled"),
  warningDetail: document.getElementById("warning-detail"),
  soundOnWarning: document.getElementById("soundOnWarning"),
  warningSeconds: document.getElementById("warningSeconds"),
  idleEnabled: document.getElementById("idleEnabled"),
  idleDetail: document.getElementById("idle-detail"),
  idleMinutes: document.getElementById("idleMinutes"),
  idleAutoResume: document.getElementById("idleAutoResume"),
  shortcutValue: document.getElementById("shortcut-value"),
  changeShortcutBtn: document.getElementById("change-shortcut-btn"),
  statsWindow: document.getElementById("statsWindow"),
  focusTotalLine: document.getElementById("focus-total-line"),
  resetStatsBtn: document.getElementById("reset-stats-btn"),
  blockingHint: document.getElementById("blocking-hint"),
  modeRadios: Array.from(document.querySelectorAll('input[name="blockMode"]')),
  modeExplainer: document.getElementById("mode-explainer"),
  foldersHint: document.getElementById("folders-hint"),
  siteFolders: document.getElementById("site-folders"),
  listEditor: document.getElementById("list-editor"),
  siteInput: document.getElementById("site-input"),
  addSiteBtn: document.getElementById("add-site-btn"),
  siteList: document.getElementById("site-list"),
  emptyHint: document.getElementById("empty-hint"),
  presetList: document.getElementById("preset-list"),
  presetEmptyHint: document.getElementById("preset-empty-hint"),
  presetNameInput: document.getElementById("preset-name-input"),
  savePresetBtn: document.getElementById("save-preset-btn"),
  profileList: document.getElementById("profile-list"),
  profileEmptyHint: document.getElementById("profile-empty-hint"),
  profileNameInput: document.getElementById("profile-name-input"),
  saveProfileBtn: document.getElementById("save-profile-btn"),
  exportJsonBtn: document.getElementById("export-json-btn"),
  importJsonBtn: document.getElementById("import-json-btn"),
  importJsonInput: document.getElementById("import-json-input"),
  exportCsvBtn: document.getElementById("export-csv-btn"),
  resetDefaultsBtn: document.getElementById("reset-defaults-btn"),
  savedIndicator: document.getElementById("saved-indicator"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  taskList: document.getElementById("task-list"),
  taskEmptyHint: document.getElementById("task-empty-hint"),
  taskInput: document.getElementById("task-input"),
  addTaskBtn: document.getElementById("add-task-btn"),
  taskFoot: document.getElementById("task-foot"),
  taskCountLine: document.getElementById("task-count-line"),
  clearDoneBtn: document.getElementById("clear-done-btn"),
  clearAllBtn: document.getElementById("clear-all-btn"),
  timerPanel: document.getElementById("timer-panel"),
  versionLine: document.getElementById("version-line"),
};

initTheme(els.themeToggleBtn);
initTimerPanel(els.timerPanel);

// Read straight from the manifest so this never drifts from the real version.
els.versionLine.textContent = t("options_versionLine", [chrome.runtime.getManifest().version]);

// Chrome (not this page) owns the actual key binding — this only displays
// whatever it currently is and links out to where it can be changed.
async function renderShortcut() {
  if (!chrome.commands?.getAll) {
    els.shortcutValue.textContent = t("options_shortcutNotAvailable");
    return;
  }
  const commands = await chrome.commands.getAll();
  const toggle = commands.find((c) => c.name === "toggle-timer");
  els.shortcutValue.textContent = toggle?.shortcut || t("options_shortcutNotSet");
}
renderShortcut();

els.changeShortcutBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

let settings = { ...DEFAULT_SETTINGS };
let stats = { ...DEFAULT_STATS };
let timerState = { ...DEFAULT_TIMER_STATE };
let tasks = [];
let presets = [];
let blockingProfiles = [];
let activeTaskId = null;
let savedIndicatorTimeout = null;

// Folder names the user has expanded, so a re-render doesn't collapse them.
const openFolders = new Set();

// Blacklist and whitelist are stored separately; all list editing on this page
// acts on whichever one the current mode uses.
function listKey() {
  return settings.blockMode === BLOCK_MODE.WHITELIST ? "whitelist" : "blacklist";
}
function currentList() {
  return settings[listKey()] ?? [];
}
function setCurrentList(next) {
  settings[listKey()] = next;
}

// Restrictive mode + a live session = timer/blocking controls are frozen.
function isLocked() {
  return settings.restrictiveMode && timerState.status !== STATUS.IDLE;
}

const MODE_EXPLAINER_KEYS = {
  [BLOCK_MODE.OFF]: "options_modeExplainerOff",
  [BLOCK_MODE.BLACKLIST]: "options_modeExplainerBlacklist",
  [BLOCK_MODE.WHITELIST]: "options_modeExplainerWhitelist",
};

// Push the scalar setting values onto their controls (everything except the
// site list / folders, which have their own renderers).
function syncControlsFromSettings() {
  els.restrictiveMode.checked = settings.restrictiveMode;
  els.workMinutes.value = settings.workMinutes;
  els.restMinutes.value = settings.restMinutes;
  els.cyclesBeforeLongBreak.value = settings.cyclesBeforeLongBreak;
  els.longBreakMinutes.value = settings.longBreakMinutes;
  els.soundOnEnd.checked = settings.soundOnEnd;
  els.badgeCountdown.checked = settings.badgeCountdown;
  els.warningEnabled.checked = settings.warningEnabled;
  els.soundOnWarning.checked = settings.soundOnWarning;
  els.warningSeconds.value = settings.warningSeconds;
  els.idleEnabled.checked = settings.idleEnabled;
  els.idleMinutes.value = settings.idleMinutes;
  els.idleAutoResume.checked = settings.idleAutoResume;
  els.statsWindow.value = settings.statsWindow;
  els.modeRadios.forEach((radio) => (radio.checked = radio.value === settings.blockMode));
  els.warningDetail.style.display = settings.warningEnabled ? "grid" : "none";
  els.idleDetail.style.display = settings.idleEnabled ? "grid" : "none";
  els.modeExplainer.textContent = t(MODE_EXPLAINER_KEYS[settings.blockMode]) || "";
}

function populateForm() {
  syncControlsFromSettings();
  renderFocusTotal();
  renderSiteList();
  renderFolders();
  renderPresets();
  renderBlockingProfiles();
  applyBlockingVisibility();
  applyRestrictiveLock();
}

// Disable the timer/blocking controls while restrictive mode has them frozen,
// and stop restrictive mode itself from being toggled during a session.
function applyRestrictiveLock() {
  const locked = isLocked();
  const sessionActive = timerState.status !== STATUS.IDLE;

  [els.workMinutes, els.restMinutes, els.cyclesBeforeLongBreak, els.longBreakMinutes].forEach(
    (el) => (el.disabled = locked)
  );
  els.modeRadios.forEach((radio) => (radio.disabled = locked));
  els.siteInput.disabled = locked;
  els.addSiteBtn.disabled = locked;
  [els.idleEnabled, els.idleMinutes, els.idleAutoResume].forEach((el) => (el.disabled = locked));
  els.restrictiveMode.disabled = sessionActive;

  els.timerLockNote.hidden = !locked;
  els.blockingLockNote.hidden = !locked;
  els.idleLockNote.hidden = !locked;
  els.restrictiveActiveNote.hidden = !sessionActive;

  // Applying a preset would touch the same fields restrictive mode just froze.
  Array.from(els.presetList.querySelectorAll(".preset-apply")).forEach((btn) => {
    if (btn.dataset.active !== "true") btn.disabled = locked;
  });
}

// A preset "matches" when its four duration fields agree with the current
// settings — used to mark it active and skip a no-op Apply.
function presetMatchesSettings(preset) {
  return (
    preset.workMinutes === settings.workMinutes &&
    preset.restMinutes === settings.restMinutes &&
    preset.cyclesBeforeLongBreak === settings.cyclesBeforeLongBreak &&
    preset.longBreakMinutes === settings.longBreakMinutes
  );
}

function presetSummary(preset) {
  return t("options_presetSummary", [
    String(preset.workMinutes),
    String(preset.restMinutes),
    String(preset.cyclesBeforeLongBreak),
    String(preset.longBreakMinutes),
  ]);
}

function renderPresets() {
  els.presetList.innerHTML = "";
  els.presetEmptyHint.style.display = presets.length ? "none" : "block";
  const locked = isLocked();

  for (const preset of presets) {
    const active = presetMatchesSettings(preset);
    const li = document.createElement("li");
    li.className = "preset-row" + (active ? " active" : "");

    const info = document.createElement("div");
    info.className = "preset-info";
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = preset.name;
    const summary = document.createElement("span");
    summary.className = "preset-summary";
    summary.textContent = presetSummary(preset);
    info.append(name, summary);

    const actions = document.createElement("div");
    actions.className = "preset-actions";

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "preset-apply";
    applyBtn.dataset.active = String(active);
    applyBtn.textContent = active ? t("common_active") : t("common_apply");
    applyBtn.disabled = active || locked;
    applyBtn.addEventListener("click", () => applyPreset(preset));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "preset-remove";
    removeBtn.textContent = t("common_remove");
    removeBtn.addEventListener("click", () => removePreset(preset.id));

    actions.append(applyBtn, removeBtn);
    li.append(info, actions);
    els.presetList.appendChild(li);
  }
}

function applyPreset(preset) {
  if (isLocked()) return;
  settings = {
    ...settings,
    workMinutes: preset.workMinutes,
    restMinutes: preset.restMinutes,
    cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
    longBreakMinutes: preset.longBreakMinutes,
  };
  syncControlsFromSettings();
  renderPresets();
  persist();
}

function newPresetId() {
  try {
    return crypto.randomUUID();
  } catch {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

async function savePreset() {
  const name = els.presetNameInput.value.trim();
  if (!name) return;
  presets = [
    ...presets,
    {
      id: newPresetId(),
      name: name.slice(0, 60),
      workMinutes: settings.workMinutes,
      restMinutes: settings.restMinutes,
      cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak,
      longBreakMinutes: settings.longBreakMinutes,
    },
  ];
  els.presetNameInput.value = "";
  renderPresets();
  await setPresets(presets);
  showSaved();
}

async function removePreset(id) {
  presets = presets.filter((p) => p.id !== id);
  renderPresets();
  await setPresets(presets);
  showSaved();
}

els.savePresetBtn.addEventListener("click", savePreset);
els.presetNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    savePreset();
  }
});

// --- Blocking profiles -------------------------------------------------

const MODE_LABEL_KEYS = {
  [BLOCK_MODE.OFF]: "common_blockModeOff",
  [BLOCK_MODE.BLACKLIST]: "common_blockModeBlacklist",
  [BLOCK_MODE.WHITELIST]: "common_blockModeWhitelist",
};

function profileMatchesSettings(profile) {
  return (
    profile.blockMode === settings.blockMode &&
    JSON.stringify(profile.blacklist) === JSON.stringify(settings.blacklist ?? []) &&
    JSON.stringify(profile.whitelist) === JSON.stringify(settings.whitelist ?? [])
  );
}

function profileSummary(profile) {
  if (profile.blockMode === BLOCK_MODE.OFF) return t("options_profileBlockingOff");
  const count =
    profile.blockMode === BLOCK_MODE.WHITELIST ? profile.whitelist.length : profile.blacklist.length;
  const countLabel = t(count === 1 ? "options_profileSiteCount" : "options_profileSiteCountPlural", [String(count)]);
  return `${t(MODE_LABEL_KEYS[profile.blockMode])} · ${countLabel}`;
}

function renderBlockingProfiles() {
  els.profileList.innerHTML = "";
  els.profileEmptyHint.style.display = blockingProfiles.length ? "none" : "block";
  const locked = isLocked();

  for (const profile of blockingProfiles) {
    const active = profileMatchesSettings(profile);
    const li = document.createElement("li");
    li.className = "preset-row" + (active ? " active" : "");

    const info = document.createElement("div");
    info.className = "preset-info";
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = profile.name;
    const summary = document.createElement("span");
    summary.className = "preset-summary";
    summary.textContent = profileSummary(profile);
    info.append(name, summary);

    const actions = document.createElement("div");
    actions.className = "preset-actions";

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "preset-apply";
    applyBtn.textContent = active ? t("common_active") : t("common_apply");
    applyBtn.disabled = active || locked;
    applyBtn.addEventListener("click", () => applyBlockingProfile(profile));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "preset-remove";
    removeBtn.textContent = t("common_remove");
    removeBtn.addEventListener("click", () => removeBlockingProfile(profile.id));

    actions.append(applyBtn, removeBtn);
    li.append(info, actions);
    els.profileList.appendChild(li);
  }
}

function applyBlockingProfile(profile) {
  if (isLocked()) return;
  settings = {
    ...settings,
    blockMode: profile.blockMode,
    blacklist: profile.blacklist.slice(),
    whitelist: profile.whitelist.slice(),
  };
  syncControlsFromSettings();
  renderFolders();
  renderSiteList();
  applyBlockingVisibility();
  renderBlockingProfiles();
  persist();
}

function newProfileId() {
  try {
    return crypto.randomUUID();
  } catch {
    return "bp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

async function saveBlockingProfile() {
  const name = els.profileNameInput.value.trim();
  if (!name) return;
  blockingProfiles = [
    ...blockingProfiles,
    {
      id: newProfileId(),
      name: name.slice(0, 60),
      blockMode: settings.blockMode,
      blacklist: (settings.blacklist ?? []).slice(),
      whitelist: (settings.whitelist ?? []).slice(),
    },
  ];
  els.profileNameInput.value = "";
  renderBlockingProfiles();
  await setBlockingProfiles(blockingProfiles);
  showSaved();
}

async function removeBlockingProfile(id) {
  blockingProfiles = blockingProfiles.filter((p) => p.id !== id);
  renderBlockingProfiles();
  await setBlockingProfiles(blockingProfiles);
  showSaved();
}

els.saveProfileBtn.addEventListener("click", saveBlockingProfile);
els.profileNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveBlockingProfile();
  }
});

function renderFocusTotal() {
  const total = formatFocusDuration(totalFocusMs(stats, timerState, settings));
  const label = statsWindowLabel(settings.statsWindow);
  els.focusTotalLine.textContent = t("options_focusTotalLine", [total, label]);
}

// Hide the site input, the added-sites list, and the quick-add folders while
// blocking is off — there's nothing for them to act on in that mode.
function applyBlockingVisibility() {
  const off = settings.blockMode === BLOCK_MODE.OFF;
  els.blockingHint.hidden = off;
  els.foldersHint.hidden = off;
  els.siteFolders.hidden = off;
  els.listEditor.hidden = off;
}

// Every hostname that belongs to a folder in the current mode — these are
// managed via the folder checkboxes, so they're kept out of the manual list.
function folderSitesForMode() {
  return new Set((SITE_FOLDERS[settings.blockMode] ?? []).flatMap((folder) => folder.sites));
}

function setSiteSelected(site, selected) {
  const list = currentList();
  const has = list.includes(site);
  if (selected && !has) setCurrentList([...list, site]);
  else if (!selected && has) setCurrentList(list.filter((entry) => entry !== site));
}

function renderFolders() {
  const folders = SITE_FOLDERS[settings.blockMode] ?? [];
  const locked = isLocked();
  els.siteFolders.innerHTML = "";

  for (const folder of folders) {
    const details = document.createElement("details");
    details.className = "folder";
    details.open = openFolders.has(folder.name);
    details.addEventListener("toggle", () => {
      if (details.open) openFolders.add(folder.name);
      else openFolders.delete(folder.name);
    });

    const summary = document.createElement("summary");
    summary.className = "folder-header";

    const folderCheckbox = document.createElement("input");
    folderCheckbox.type = "checkbox";
    folderCheckbox.disabled = locked;
    // Don't let toggling the checkbox also open/close the <details>.
    folderCheckbox.addEventListener("click", (event) => event.stopPropagation());
    folderCheckbox.addEventListener("change", () => {
      const selectAll = folderCheckbox.checked;
      folder.sites.forEach((site) => setSiteSelected(site, selectAll));
      renderFolders();
      renderSiteList();
      persist();
    });

    const title = document.createElement("span");
    title.className = "folder-title";
    title.textContent = folder.name;

    const count = document.createElement("span");
    count.className = "folder-count";

    summary.append(folderCheckbox, title, count);
    details.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "folder-sites";
    for (const site of folder.sites) {
      const li = document.createElement("li");
      const siteLabel = document.createElement("label");
      siteLabel.className = "folder-site";
      const siteCheckbox = document.createElement("input");
      siteCheckbox.type = "checkbox";
      siteCheckbox.disabled = locked;
      siteCheckbox.checked = currentList().includes(site);
      siteCheckbox.addEventListener("change", () => {
        setSiteSelected(site, siteCheckbox.checked);
        renderFolders();
        renderSiteList();
        persist();
      });
      const siteName = document.createElement("span");
      siteName.textContent = site;
      siteLabel.append(siteCheckbox, siteName);
      li.appendChild(siteLabel);
      list.appendChild(li);
    }
    details.appendChild(list);

    const selectedCount = folder.sites.filter((site) => currentList().includes(site)).length;
    folderCheckbox.checked = selectedCount === folder.sites.length;
    folderCheckbox.indeterminate = selectedCount > 0 && selectedCount < folder.sites.length;
    count.textContent = `${selectedCount} / ${folder.sites.length}`;

    els.siteFolders.appendChild(details);
  }
}

function renderSiteList() {
  const managed = folderSitesForMode();
  const custom = currentList().filter((site) => !managed.has(site));

  els.siteList.innerHTML = "";
  els.emptyHint.style.display = custom.length ? "none" : "block";
  for (const site of custom) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = site;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t("common_remove");
    removeBtn.disabled = isLocked();
    removeBtn.addEventListener("click", () => {
      setCurrentList(currentList().filter((entry) => entry !== site));
      renderSiteList();
      renderFolders();
      persist();
    });
    li.append(label, removeBtn);
    els.siteList.appendChild(li);
  }
}

function readNumberField(el, fallback, { min = 1, max = Infinity } = {}) {
  const value = Number(el.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readFormIntoSettings() {
  settings = {
    ...settings,
    restrictiveMode: els.restrictiveMode.checked,
    workMinutes: readNumberField(els.workMinutes, settings.workMinutes, { min: 1, max: 180 }),
    restMinutes: readNumberField(els.restMinutes, settings.restMinutes, { min: 1, max: 60 }),
    cyclesBeforeLongBreak: readNumberField(els.cyclesBeforeLongBreak, settings.cyclesBeforeLongBreak, {
      min: 1,
      max: 12,
    }),
    longBreakMinutes: readNumberField(els.longBreakMinutes, settings.longBreakMinutes, { min: 1, max: 120 }),
    soundOnEnd: els.soundOnEnd.checked,
    badgeCountdown: els.badgeCountdown.checked,
    warningEnabled: els.warningEnabled.checked,
    soundOnWarning: els.soundOnWarning.checked,
    warningSeconds: readNumberField(els.warningSeconds, settings.warningSeconds, { min: 5, max: 120 }),
    idleEnabled: els.idleEnabled.checked,
    idleMinutes: readNumberField(els.idleMinutes, settings.idleMinutes, { min: 1, max: 30 }),
    idleAutoResume: els.idleAutoResume.checked,
    statsWindow: els.statsWindow.value,
  };
}

function showSaved() {
  els.savedIndicator.textContent = t("options_saved");
  els.savedIndicator.classList.add("visible");
  clearTimeout(savedIndicatorTimeout);
  savedIndicatorTimeout = setTimeout(() => els.savedIndicator.classList.remove("visible"), 1200);
}

async function persist() {
  await setSettings(settings);
  // Let the background worker know so it can re-schedule alarms if a timer
  // is currently running (e.g. warning settings changed mid-session).
  chrome.runtime.sendMessage({ type: "opentomato:save-settings", settings }).catch(() => {});
  // Every settings mutation in this file funnels through here, so this is the
  // one place needed to keep the presets/profiles "active" highlighting and
  // lock state in sync with whatever just changed.
  renderPresets();
  renderBlockingProfiles();
  showSaved();
}

function onFieldChange() {
  readFormIntoSettings();
  els.warningDetail.style.display = settings.warningEnabled ? "grid" : "none";
  els.idleDetail.style.display = settings.idleEnabled ? "grid" : "none";
  applyRestrictiveLock();
  persist();
}

[
  els.workMinutes,
  els.restMinutes,
  els.cyclesBeforeLongBreak,
  els.longBreakMinutes,
  els.warningSeconds,
  els.idleMinutes,
].forEach((el) => el.addEventListener("change", onFieldChange));

[
  els.restrictiveMode,
  els.soundOnEnd,
  els.badgeCountdown,
  els.warningEnabled,
  els.soundOnWarning,
  els.idleEnabled,
  els.idleAutoResume,
].forEach((el) => el.addEventListener("change", onFieldChange));

els.statsWindow.addEventListener("change", () => {
  settings.statsWindow = els.statsWindow.value;
  renderFocusTotal();
  persist();
});

els.resetStatsBtn.addEventListener("click", async () => {
  if (!confirm(t("options_confirmResetStats"))) return;
  await chrome.runtime.sendMessage({ type: "opentomato:reset-stats" }).catch(() => {});
  stats = await getStats();
  renderFocusTotal();
  showSaved();
});

els.modeRadios.forEach((radio) =>
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    settings.blockMode = radio.value;
    els.modeExplainer.textContent = t(MODE_EXPLAINER_KEYS[settings.blockMode]) || "";
    renderFolders();
    renderSiteList();
    applyBlockingVisibility();
    persist();
  })
);

function addSite() {
  const normalized = normalizeEntry(els.siteInput.value);
  els.siteInput.value = "";
  if (!normalized) return;
  if (currentList().includes(normalized)) return;
  setCurrentList([...currentList(), normalized]);
  renderSiteList();
  renderFolders();
  persist();
}

els.addSiteBtn.addEventListener("click", addSite);
els.siteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addSite();
  }
});

els.resetDefaultsBtn.addEventListener("click", () => {
  if (!confirm(t("options_confirmResetDefaults"))) return;
  settings = { ...DEFAULT_SETTINGS, blacklist: [], whitelist: [] };
  populateForm();
  persist();
});

// --- Tasks -----------------------------------------------------------------

function newTaskId() {
  try {
    return crypto.randomUUID();
  } catch {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

function taskCounts() {
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

function renderTaskCount() {
  const { done, total } = taskCounts();
  els.taskCountLine.textContent = total ? t("options_taskCountLine", [String(done), String(total)]) : "";
}

// Drag-to-reorder: which task is currently being dragged, tracked module-wide
// since it spans several elements' event handlers.
let draggedTaskId = null;

function renderTasks() {
  els.taskList.innerHTML = "";
  els.taskEmptyHint.style.display = tasks.length ? "none" : "block";
  els.taskFoot.hidden = tasks.length === 0;

  for (const task of tasks) {
    const isActive = task.id === activeTaskId;
    const li = document.createElement("li");
    li.className = "task-row" + (task.done ? " done" : "") + (isActive ? " active" : "");
    li.draggable = true;

    li.addEventListener("dragstart", (event) => {
      draggedTaskId = task.id;
      event.dataTransfer.effectAllowed = "move";
      // Let the drag image render before the dragged row starts fading.
      requestAnimationFrame(() => li.classList.add("dragging"));
    });
    li.addEventListener("dragend", () => {
      draggedTaskId = null;
      renderTasks(); // clears "dragging"/"drag-over" classes on every row
    });
    li.addEventListener("dragover", (event) => {
      if (!draggedTaskId || draggedTaskId === task.id) return;
      event.preventDefault();
      li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", (event) => {
      event.preventDefault();
      li.classList.remove("drag-over");
      if (!draggedTaskId || draggedTaskId === task.id) return;
      reorderTasks(draggedTaskId, task.id);
    });

    const dragHandle = document.createElement("span");
    dragHandle.className = "task-drag-handle";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.textContent = "⠿";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = task.done;
    check.setAttribute("aria-label", t("options_taskMarkDone"));
    check.addEventListener("change", () => {
      task.done = check.checked;
      li.classList.toggle("done", task.done);
      // A finished task has nothing left to credit pomodoros toward.
      if (task.done && activeTaskId === task.id) setActiveTask(task.id);
      renderTaskCount();
      persistTasks();
    });

    const text = document.createElement("input");
    text.type = "text";
    text.className = "task-text";
    text.maxLength = 200;
    text.value = task.text;
    text.addEventListener("change", () => {
      const v = text.value.trim();
      if (!v) {
        removeTask(task.id); // empty text removes it
        return;
      }
      task.text = v;
      persistTasks();
    });

    const estimate = document.createElement("input");
    estimate.type = "number";
    estimate.className = "task-estimate";
    estimate.min = "1";
    estimate.max = "99";
    estimate.step = "1";
    estimate.placeholder = t("options_taskEstimatePlaceholder");
    estimate.title = t("options_taskEstimateTitle");
    estimate.setAttribute("aria-label", t("options_taskEstimateTitle"));
    estimate.value = task.estimate ?? "";
    estimate.addEventListener("change", () => {
      const v = Number(estimate.value);
      task.estimate = Number.isFinite(v) && v > 0 ? Math.round(v) : null;
      estimate.value = task.estimate ?? "";
      progress.textContent = task.estimate ? `${task.actual}/${task.estimate}` : task.actual ? t("options_taskProgressDone", [String(task.actual)]) : "";
      persistTasks();
    });

    const progress = document.createElement("span");
    progress.className = "task-progress";
    progress.textContent = task.estimate ? `${task.actual}/${task.estimate}` : task.actual ? t("options_taskProgressDone", [String(task.actual)]) : "";

    const activeBtn = document.createElement("button");
    activeBtn.type = "button";
    activeBtn.className = "task-active-btn" + (isActive ? " active" : "");
    activeBtn.textContent = isActive ? t("common_active") : t("options_taskSetActive");
    activeBtn.title = isActive
      ? t("options_taskStopCrediting")
      : t("options_taskStartCrediting");
    activeBtn.addEventListener("click", () => setActiveTask(task.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost task-remove";
    remove.textContent = t("common_remove");
    remove.addEventListener("click", () => removeTask(task.id));

    li.append(dragHandle, check, text, estimate, progress, activeBtn, remove);
    els.taskList.appendChild(li);
  }
  renderTaskCount();
}

function reorderTasks(draggedId, targetId) {
  const fromIndex = tasks.findIndex((t) => t.id === draggedId);
  const toIndex = tasks.findIndex((t) => t.id === targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
  const reordered = tasks.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  tasks = reordered;
  renderTasks();
  persistTasks();
}

async function setActiveTask(id) {
  activeTaskId = activeTaskId === id ? null : id;
  renderTasks();
  await setActiveTaskId(activeTaskId);
}

function removeTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  if (activeTaskId === id) activeTaskId = null;
  renderTasks();
  persistTasks();
  setActiveTaskId(activeTaskId);
}

function addTask() {
  const value = els.taskInput.value.trim();
  els.taskInput.value = "";
  if (!value) return;
  tasks = [...tasks, { id: newTaskId(), text: value.slice(0, 200), done: false, estimate: null, actual: 0 }];
  renderTasks();
  persistTasks();
}

function clearCompleted() {
  if (!tasks.some((t) => t.done)) return;
  tasks = tasks.filter((t) => !t.done);
  renderTasks();
  persistTasks();
}

function clearAllTasks() {
  if (!tasks.length) return;
  if (!confirm(t("options_confirmClearAllTasks"))) return;
  tasks = [];
  activeTaskId = null;
  renderTasks();
  persistTasks();
  setActiveTaskId(null);
}

async function persistTasks() {
  await setTasks(tasks);
  showSaved();
}

els.addTaskBtn.addEventListener("click", addTask);
els.taskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTask();
  }
});
els.clearDoneBtn.addEventListener("click", clearCompleted);
els.clearAllBtn.addEventListener("click", clearAllTasks);

// --- Backup: export / import (JSON), export (CSV) ---------------------------

const BACKUP_FORMAT = "opentomato-backup";
const BACKUP_VERSION = 1;

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function exportJsonBackup() {
  const bundle = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    data: {
      settings,
      stats,
      tasks,
      presets,
      blockingProfiles,
      activeTaskId,
      theme: await getTheme(),
    },
  };
  triggerDownload(`opentomato-backup-${dateStamp()}.json`, JSON.stringify(bundle, null, 2), "application/json");
}

async function importJsonBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    alert(t("options_importInvalidJson"));
    return;
  }
  if (parsed?.format !== BACKUP_FORMAT || !isPlainObject(parsed.data)) {
    alert(t("options_importNotBackup"));
    return;
  }
  if (!confirm(t("options_confirmImport"))) {
    return;
  }

  const data = parsed.data;
  if (isPlainObject(data.settings)) {
    settings = sanitizeSettings(data.settings);
    await setSettings(settings);
  }
  if (isPlainObject(data.stats)) {
    stats = sanitizeStats(data.stats);
    await setStats(stats);
  }
  if (Array.isArray(data.tasks)) {
    tasks = sanitizeTasks(data.tasks);
    await setTasks(tasks);
  }
  if (Array.isArray(data.presets)) {
    presets = sanitizePresets(data.presets);
    await setPresets(presets);
  }
  if (Array.isArray(data.blockingProfiles)) {
    blockingProfiles = sanitizeBlockingProfiles(data.blockingProfiles);
    await setBlockingProfiles(blockingProfiles);
  }
  if (typeof data.activeTaskId === "string" && tasks.some((t) => t.id === data.activeTaskId)) {
    activeTaskId = data.activeTaskId;
  } else {
    activeTaskId = null;
  }
  await setActiveTaskId(activeTaskId);
  if (typeof data.theme === "string") {
    await setTheme(data.theme);
  }

  timerState = await getTimerState(); // unaffected by import, but re-sync the lock state
  populateForm();
  renderTasks();
  showSaved();
  alert(t("options_importComplete"));
}

function csvEscape(value) {
  const s = String(value);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsvHistory() {
  const rows = [[t("options_csvHeaderEnd"), t("options_csvHeaderMinutes")]];
  for (const entry of Array.isArray(stats.focusLog) ? stats.focusLog : []) {
    rows.push([new Date(entry.end).toISOString(), (entry.ms / 60000).toFixed(2)]);
  }
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  triggerDownload(`opentomato-focus-history-${dateStamp()}.csv`, csv, "text/csv");
}

els.exportJsonBtn.addEventListener("click", exportJsonBackup);
els.importJsonBtn.addEventListener("click", () => els.importJsonInput.click());
els.importJsonInput.addEventListener("change", async () => {
  const file = els.importJsonInput.files?.[0];
  els.importJsonInput.value = ""; // allow re-selecting the same file later
  if (file) await importJsonBackup(file);
});
els.exportCsvBtn.addEventListener("click", exportCsvHistory);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.tasks) {
    const next = Array.isArray(changes.tasks.newValue) ? changes.tasks.newValue : [];
    tasks = next
      .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
      .map((t) => ({
        id: t.id,
        text: t.text,
        done: !!t.done,
        estimate: Number.isFinite(Number(t.estimate)) && Number(t.estimate) > 0 ? Math.round(Number(t.estimate)) : null,
        actual: Number.isFinite(Number(t.actual)) && Number(t.actual) >= 0 ? Math.round(Number(t.actual)) : 0,
      }));
    // Don't yank a task's text field out from under an in-progress edit.
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("task-text")) {
      renderTaskCount();
    } else {
      renderTasks();
    }
  }

  if (changes.activeTaskId) {
    activeTaskId = typeof changes.activeTaskId.newValue === "string" ? changes.activeTaskId.newValue : null;
    renderTasks();
  }

  if (changes.stats) stats = { ...DEFAULT_STATS, ...(changes.stats.newValue || {}) };

  if (changes.timerState) {
    timerState = { ...DEFAULT_TIMER_STATE, ...(changes.timerState.newValue || {}) };
    // A session starting/stopping flips the restrictive-mode lock.
    renderFocusTotal();
    renderFolders();
    renderSiteList();
    renderPresets();
    renderBlockingProfiles();
    applyRestrictiveLock();
  } else if (changes.stats) {
    renderFocusTotal();
  }

  if (changes.presets) {
    presets = Array.isArray(changes.presets.newValue) ? changes.presets.newValue : [];
    renderPresets();
  }

  if (changes.blockingProfiles) {
    blockingProfiles = Array.isArray(changes.blockingProfiles.newValue)
      ? changes.blockingProfiles.newValue
      : [];
    renderBlockingProfiles();
  }

  // React to settings written elsewhere (another tab, or the worker snapping a
  // frozen field back). Only re-render the site editor if the lists really moved.
  if (changes.settings) {
    const next = changes.settings.newValue || {};
    const listsChanged =
      next.blockMode !== settings.blockMode ||
      JSON.stringify(next.blacklist ?? []) !== JSON.stringify(settings.blacklist ?? []) ||
      JSON.stringify(next.whitelist ?? []) !== JSON.stringify(settings.whitelist ?? []);
    settings = { ...DEFAULT_SETTINGS, ...next };
    settings.blacklist = Array.isArray(settings.blacklist) ? settings.blacklist : [];
    settings.whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
    syncControlsFromSettings();
    applyBlockingVisibility();
    renderPresets();
    renderBlockingProfiles();
    applyRestrictiveLock();
    renderFocusTotal();
    if (listsChanged) {
      renderFolders();
      renderSiteList();
    }
  }
});

setInterval(renderFocusTotal, 1000);

(async function init() {
  [settings, stats, timerState, tasks, presets, blockingProfiles, activeTaskId] = await Promise.all([
    getSettings(),
    getStats(),
    getTimerState(),
    getTasks(),
    getPresets(),
    getBlockingProfiles(),
    getActiveTaskId(),
  ]);
  populateForm();
  renderTasks();
})();
