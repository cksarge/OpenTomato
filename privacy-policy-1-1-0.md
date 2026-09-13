<!--
  PRERELEASE DRAFT — the OpenTomato 1.1.0 privacy policy.

  privacy.html serves versioned policy files: privacy-policy-X-Y-Z.md (dots
  become dashes). With no #version in the URL it serves whichever version
  OPENTOMATO_PRIVACY_VERSION in assets/config.js names as live (currently
  1.0.0, so this file is reachable now only at privacy.html#1.1.0 — handy for
  pointing the Chrome Web Store's privacy policy field at it while 1.1.0 is
  pending review). When 1.1.0 actually ships, just update
  OPENTOMATO_PRIVACY_VERSION to "1.1.0" — this file becomes the default at
  privacy.html with no further changes, and older versions stay reachable
  forever at their own #version URL.

  Differences from 1.0.0: adds the Tasks checklist and saved duration presets
  to what's stored, discloses the content script that links the website demo
  page to the timer, and adds the `idle` permission plus its settings for the
  new idle-detection feature.
-->

# Privacy Policy

**Effective date:** September 9, 2026 &nbsp;·&nbsp; **Extension version:** 1.1.0

OpenTomato is built around a simple rule: nothing about how you use it ever leaves your device.
This page explains exactly what that means.

## The short version

- OpenTomato does not collect, transmit, sell, or share any data — ever.
- There are no accounts, no sign-ups, and no servers operated by OpenTomato.
- There is no analytics, advertising, or tracking of any kind, from us or from any third party.
- Everything the extension needs to work — your timer settings, your blocked/allowed site lists,
  your current timer state, your focus-time history, and your task checklist — is stored locally
  in your browser using the standard `chrome.storage.local` API, and is never sent anywhere.
- When a page is blocked, the address you were heading to is passed to OpenTomato's own local
  "blocked" page (and, if you choose "Continue anyway", briefly remembered in memory) purely so it
  can send you back there. It is never transmitted or written to disk.
- OpenTomato is open source. You (or anyone) can read the full source code to verify all of this
  directly: [github.com/cksarge/OpenTomato](https://github.com/cksarge/OpenTomato).

## What information OpenTomato stores, and where

OpenTomato stores the following, only in your browser's local extension storage:

- **Timer settings** — your focus/break durations, how many focus sessions happen before a long
  break, your sound/notification and toolbar-badge preferences, whether restrictive mode is on,
  whether idle detection is on (and its away-after-minutes and auto-resume preferences), and the
  window your focus-time total is measured over.
- **Site lists** — the domains you've chosen to blacklist or whitelist during focus sessions
  (kept as two separate lists).
- **Timer state** — the current phase (focus, short break, long break), whether the timer is
  running, and how much time is left.
- **Focus-time history** — a local log of how long each focus stretch lasted, used only to show
  the "time focused" total in the popup. It stays on your device, is capped to roughly the last
  45 days, and can be wiped anytime with the "Reset focus total" button in settings.
- **Tasks** — the checklist shown in the popup: each task's text and whether it's checked off.
  You add, rename, and remove tasks on the settings page (and can check them off from the popup
  too). It stays on your device and is removed when you uninstall.
- **Duration presets** — any named timer-duration configurations you save (e.g. "Classic 25/5"),
  so you can switch between them from the popup or settings instead of re-typing durations. Stays
  on your device and is removed when you uninstall.
- **"Continue anyway" allowances** — if you choose to proceed past a blocked page, OpenTomato
  keeps the site's domain in temporary in-memory storage (`chrome.storage.session`) so it isn't
  re-blocked for the rest of that session. This list is discarded when the tab closes, when a new
  focus session starts, or when the browser closes, and is never written to disk or sent anywhere.

None of this is synced to a remote server, included in any analytics payload, or accessible to
anyone but you on your own device. Uninstalling the extension removes this data along with it.

## Permissions OpenTomato requests, and why

Chrome extensions must declare the permissions they use. Here's what OpenTomato requests and what
each one is for:

| Permission | Why OpenTomato needs it |
| --- | --- |
| `storage` | To save — only on your device — your timer settings, the current timer state (phase, running or paused, time left), your blacklist and whitelist, your focus-time history, your task checklist, your saved duration presets, and your theme choice. Temporary "Continue anyway" allowances are held in in-memory session storage that clears when the browser closes. |
| `alarms` | Chrome shuts down the extension's background process when it's idle (a Manifest V3 requirement). Alarms wake it at the exact moment a session or break ends, at the warning point you choose just before that, and once a minute to update the toolbar badge. The background process also stays active while a timer is actively running so the countdown can't stall. |
| `webNavigation` | Only to enforce site blocking. While a focus session is running, OpenTomato checks the domain of each page you navigate to against your blacklist/whitelist — entirely on your device — and redirects to its own "blocked" page if the site is off-limits. Page contents are never read. |
| `tabs` | To redirect a tab to the "blocked" page when a site is off-limits during a focus session, to check already-open tabs when a session starts, and to forget a tab's "Continue anyway" allowance once it closes. Only a tab's URL is read — never its contents. |
| `notifications` | To show a desktop notification when a session or break ends, and — if you turn it on — shortly before a session ends. These contain only the timer's phase names and time remaining. |
| `offscreen` | Manifest V3 background workers can't play audio directly. OpenTomato uses a single hidden document solely to synthesize a short alert tone — no sound files are bundled or downloaded. |
| `idle` | Only used if you turn on idle detection in settings (it's off by default). Chrome reports whether your computer has been active, idle, or locked — OpenTomato uses this solely to pause a running session automatically when you step away, and optionally resume it when you're back, so time away from the computer doesn't silently count toward your focus total. No activity data is stored or sent anywhere; only the current state (active/idle/locked) is ever read, in the moment. |
| Host access (all sites) | Site blocking has to work for any site you add to your blacklist, and whitelist mode blocks everything except the sites you list — so OpenTomato needs to be able to check a navigation against any domain. This access is used only to read a page's domain and compare it, on your device, to your own lists. No page content is read or injected, and OpenTomato never contacts any site itself. |

None of these permissions are used to read, collect, or transmit the content of the pages you
visit — OpenTomato only ever compares a page's domain against the list you configured yourself, and
that comparison happens entirely on your device.

## The OpenTomato website demo

OpenTomato ships a tiny content script that runs on **one page only** — the OpenTomato website's
demo at `https://cksarge.github.io/OpenTomato/`. Its sole job is to tell that page the extension
is installed, and its version number, so the page can point you at the extension's own settings.

It reads and writes no data at all. It does not touch the timer, your settings, your site lists,
Restrictive Mode, tasks, or focus history. The demo page runs its own separate practice timer and
never controls or reads the real one. The content script runs on no other website and sends
nothing off your device; if you never open the demo page, it does nothing. The demo page itself is
served as a static file from GitHub Pages and sets no cookies and runs no analytics.

## Third parties

OpenTomato does not use any third-party services, SDKs, analytics providers, or advertising
networks inside the extension itself. This website (the page you're reading right now) is a
static site and does not set tracking cookies or run analytics either.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL with a new
effective date above.

## Contact

Questions about this policy or the project can be emailed to
[carterkcoding@gmail.com](mailto:carterkcoding@gmail.com), or opened as an issue on GitHub:
[github.com/cksarge/OpenTomato/issues](https://github.com/cksarge/OpenTomato/issues).
