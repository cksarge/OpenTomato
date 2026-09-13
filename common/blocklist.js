// Hostname normalization + blacklist/whitelist matching logic.
// Shared by the background script (both for live navigation checks and for
// sweeping already-open tabs when a work phase begins).

import { BLOCK_MODE } from "./constants.js";

// Schemes we should never intercept — internal browser pages, the extension's
// own pages, etc. Blocking these would risk breaking the browser itself.
const IGNORED_SCHEMES = [
  "chrome:",
  "chrome-extension:",
  "about:",
  "edge:",
  "devtools:",
  "view-source:",
  "file:",
];

export function shouldIgnoreUrl(url) {
  try {
    const { protocol } = new URL(url);
    return IGNORED_SCHEMES.includes(protocol);
  } catch {
    return true;
  }
}

// Normalize a user-entered list item. Domain-only entries keep the existing
// shape ("https://www.Youtube.com/" -> "youtube.com"). An entry with a path
// keeps a path prefix alongside the domain ("reddit.com/r/funny/" ->
// "reddit.com/r/funny"), so it blocks just that section of the site rather
// than the whole domain — everything else on reddit.com stays reachable.
export function normalizeEntry(raw) {
  let value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  // Allow entries pasted with a scheme.
  if (!/^[a-z]+:\/\//.test(value)) {
    value = "https://" + value;
  }
  try {
    const url = new URL(value);
    let hostname = url.hostname;
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    if (!hostname) return "";
    const path = url.pathname.replace(/\/+$/, ""); // "/" (root, i.e. no path) -> ""
    return path ? hostname + path : hostname;
  } catch {
    return "";
  }
}

// Split a stored entry into its domain and path-prefix parts. Entries with no
// "/" (the common case) have an empty path, meaning "the whole domain".
function parseEntry(entry) {
  const slashIndex = entry.indexOf("/");
  if (slashIndex === -1) return { host: entry, path: "" };
  return { host: entry.slice(0, slashIndex), path: entry.slice(slashIndex) };
}

// True if `hostname` is `host` or a subdomain of it.
function hostnameMatches(hostname, host) {
  return hostname === host || hostname.endsWith("." + host);
}

// Ignores any path prefix on an entry — for callers (like the "Continue
// anyway" bypass list) that only ever deal in whole hostnames.
export function matchesList(hostname, list) {
  return list.some((entry) => entry && hostnameMatches(hostname, parseEntry(entry).host));
}

// True if `pathname` (e.g. "/r/funny/hot") falls under `entryPath` (e.g.
// "/r/funny"). An empty entryPath means "the whole domain", so it always
// matches. Requires a "/" boundary so "/r/funny2" doesn't match "/r/funny".
function pathMatches(pathname, entryPath) {
  if (!entryPath) return true;
  return pathname === entryPath || pathname.startsWith(entryPath + "/");
}

// Domain + path-prefix aware version of matchesList, used for actual site
// blocking. `pathname` should already be lowercased, matching how entries are
// normalized.
export function matchesListWithPath(hostname, pathname, list) {
  return list.some((entry) => {
    if (!entry) return false;
    const { host, path } = parseEntry(entry);
    return hostnameMatches(hostname, host) && pathMatches(pathname, path);
  });
}

// The site list that applies to the current mode. Blacklist and whitelist are
// stored separately, so only one of them is ever in effect at a time.
export function activeBlockList(settings) {
  if (settings.blockMode === BLOCK_MODE.BLACKLIST) return settings.blacklist || [];
  if (settings.blockMode === BLOCK_MODE.WHITELIST) return settings.whitelist || [];
  return [];
}

// Decide whether navigating to `url` should be blocked, given the current
// block mode and list. Only ever call this while phase === 'work'.
export function isUrlBlocked(url, blockMode, blockList) {
  if (blockMode === BLOCK_MODE.OFF) return false;
  if (shouldIgnoreUrl(url)) return false;

  let hostname, pathname;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    pathname = parsed.pathname.toLowerCase(); // entries are normalized lowercase too
  } catch {
    return false;
  }

  const isListed = matchesListWithPath(hostname, pathname, blockList);
  if (blockMode === BLOCK_MODE.BLACKLIST) return isListed;
  if (blockMode === BLOCK_MODE.WHITELIST) return !isListed;
  return false;
}
