# OpenTomato

A free, open-source Pomodoro timer extension for Chrome (Manifest V3) — no ads, no paywall, no
accounts, no trackers. Every setting and every second of timer state stays on your device.

- **Customizable timer** — focus/short-break/long-break durations and how many focus sessions
  happen before a long break, all adjustable.
- **Optional sound alerts** — a tone when a session ends, and an optional heads-up warning before
  time runs out.
- **Focus-session site blocking** — blacklist distracting sites, or lock in with a whitelist.
  Blocking only applies during focus sessions; breaks are always unrestricted.
- **100% local** — everything is stored in `chrome.storage.local`; nothing is ever sent anywhere.

## Repository layout

```
extension/   The Chrome extension itself (Manifest V3): popup, settings page, background
             service worker, and the "blocked" page shown for off-limits sites.
website/     A simple static 3-page website: a homepage (index.html), a live timer
             demo (app.html), and a versioned privacy policy page (privacy.html,
             authored per-version in website/privacy-policy-X-Y-Z.md).
```

> **Branches:** this `main` branch is a lightweight landing point. The actual extension source
> lives on the [`extension`](../../tree/extension) branch (with its files at the branch root, so
> it can be loaded unpacked or zipped directly), and the website source lives on the
> [`website`](../../tree/website) branch (with its files at the branch root, ready to serve via
> GitHub Pages or any static host).

## Developing the extension

1. Switch to (or clone) the `extension` branch — or just use the `extension/` folder if you're
   working directly on `main`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the extension folder.
5. Click the OpenTomato icon in the toolbar to open the popup, or the settings gear inside it to
   open the options page.

After editing source files, click the refresh icon on the extension's card in
`chrome://extensions` to reload it.

## Developing the website

See [`website/README.md`](website/README.md).

## License

MIT — see [`LICENSE`](LICENSE).
