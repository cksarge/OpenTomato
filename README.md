# OpenTomato (extension)

The Chrome extension itself — a Manifest V3 Pomodoro timer with customizable durations, sound
alerts, and blacklist/whitelist site blocking that's only active during focus sessions.

No ads, no accounts, no analytics. Everything is stored locally via `chrome.storage.local` and
never leaves your device — see the [privacy policy](https://cksarge.github.io/OpenTomato/privacy.html)
for details.

## Loading it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the OpenTomato icon in the toolbar to open the popup, or the gear icon inside it to open
   settings.

After editing source files, click the refresh icon on the extension's card in
`chrome://extensions` to reload it.

## Running the tests

The shared logic in `common/` (phase transitions, duration math, site-list matching, focus-stats
math) has a plain Node test suite — no bundler, no dependencies, nothing that ships to Chrome:

```sh
npm test              # unit tests (node's built-in test runner)
npm run lint:syntax   # every .js file parses
npm run lint:manifest # manifest.json is valid JSON
npm run lint:locales  # every _locales/*/messages.json matches en's keys and placeholders
```

All four run in CI on every push to this branch (`.github/workflows/ci.yml`).

## Structure

```
manifest.json        Manifest V3 config
background/           Service worker: timer state machine, alarms, site-blocking logic
popup/                 Toolbar popup UI (the timer itself)
options/               Settings page (durations, sounds, site lists)
blocked/               Page shown when navigating to a blocked site during a focus session
offscreen/              Offscreen document used to play alert sounds (service workers have no audio)
bridge/                 Content script that announces the extension's presence to the demo page
common/                 Shared constants, storage helpers, and blocking/phase logic
icons/                  Extension icon source (icon.svg) and generated PNGs
```

## Repo

Full project (including the website) at [github.com/cksarge/OpenTomato](https://github.com/cksarge/OpenTomato)
— see the `main` branch for an overview, and the `website` branch for the companion site.
