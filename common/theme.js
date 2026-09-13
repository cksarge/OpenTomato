// Shared dark/light theme handling for the popup, options, and blocked pages.
//
// Preference is one of THEME_OPTIONS ('system' | 'light' | 'dark'), stored in
// chrome.storage.local so all three pages agree. 'system' means "no
// data-theme attribute" — the page's CSS then falls back to a
// prefers-color-scheme media query. An explicit 'light'/'dark' sets
// data-theme on <html>, which every page's CSS gives priority over the media
// query (see the :root[data-theme="..."] blocks in each stylesheet).

import { THEME_OPTIONS } from "./constants.js";
import { getTheme, setTheme } from "./storage.js";
import { t } from "./i18n.js";

// Small solid-fill icons (matching the settings gear's style) instead of
// emoji, so the toggle looks consistent across platforms/fonts.
const THEME_ICONS = {
  system: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <rect x="2" y="4" width="20" height="13" rx="2" fill="currentColor" />
    <rect x="9.5" y="19" width="5" height="1.6" rx="0.8" fill="currentColor" />
  </svg>`,
  light: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    <g fill="currentColor">
      <rect x="11" y="1" width="2" height="4" rx="1" />
      <rect x="11" y="19" width="2" height="4" rx="1" />
      <rect x="1" y="11" width="4" height="2" rx="1" />
      <rect x="19" y="11" width="4" height="2" rx="1" />
      <rect x="4.2" y="4.2" width="2" height="4" rx="1" transform="rotate(-45 5.2 6.2)" />
      <rect x="17.8" y="4.2" width="2" height="4" rx="1" transform="rotate(45 18.8 6.2)" />
      <rect x="4.2" y="15.8" width="2" height="4" rx="1" transform="rotate(45 5.2 17.8)" />
      <rect x="17.8" y="15.8" width="2" height="4" rx="1" transform="rotate(-45 18.8 17.8)" />
    </g>
  </svg>`,
  dark: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
  </svg>`,
};
const THEME_LABEL_KEYS = { system: "common_themeSystem", light: "common_themeLight", dark: "common_themeDark" };

function applyThemeAttribute(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

function updateToggleButton(buttonEl, theme) {
  if (!buttonEl) return;
  buttonEl.innerHTML = THEME_ICONS[theme] ?? THEME_ICONS.system;
  const themeName = t(THEME_LABEL_KEYS[theme] ?? THEME_LABEL_KEYS.system);
  const label = t("common_themeButtonLabel", [themeName]);
  buttonEl.title = label;
  buttonEl.setAttribute("aria-label", label);
}

/**
 * Applies the stored theme to this page and, if given, wires up a toggle
 * button that cycles system -> light -> dark -> system on click. Also keeps
 * this page's theme in sync if it's changed from another OpenTomato page
 * (popup/options/blocked can all be open at once).
 */
export async function initTheme(buttonEl) {
  const theme = await getTheme();
  applyThemeAttribute(theme);
  updateToggleButton(buttonEl, theme);

  if (buttonEl) {
    buttonEl.addEventListener("click", async () => {
      const current = await getTheme();
      const next = THEME_OPTIONS[(THEME_OPTIONS.indexOf(current) + 1) % THEME_OPTIONS.length];
      await setTheme(next);
      applyThemeAttribute(next);
      updateToggleButton(buttonEl, next);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.theme) return;
    applyThemeAttribute(changes.theme.newValue);
    updateToggleButton(buttonEl, changes.theme.newValue);
  });

  return theme;
}
