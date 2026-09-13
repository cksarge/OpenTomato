import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreUrl, normalizeEntry, matchesList, activeBlockList, isUrlBlocked } from "./blocklist.js";
import { BLOCK_MODE } from "./constants.js";

test("shouldIgnoreUrl is true for internal/browser schemes", () => {
  assert.equal(shouldIgnoreUrl("chrome://extensions"), true);
  assert.equal(shouldIgnoreUrl("chrome-extension://abc/options.html"), true);
  assert.equal(shouldIgnoreUrl("about:blank"), true);
  assert.equal(shouldIgnoreUrl("file:///Users/me/file.html"), true);
  assert.equal(shouldIgnoreUrl("view-source:https://example.com"), true);
});

test("shouldIgnoreUrl is false for ordinary http(s) pages", () => {
  assert.equal(shouldIgnoreUrl("https://youtube.com"), false);
  assert.equal(shouldIgnoreUrl("http://example.com"), false);
});

test("shouldIgnoreUrl treats an unparseable URL as ignorable (fail safe, never block)", () => {
  assert.equal(shouldIgnoreUrl("not a url"), true);
});

test("normalizeEntry lowercases, strips scheme and www, and keeps just the hostname", () => {
  assert.equal(normalizeEntry("https://www.YouTube.com/watch?v=1"), "youtube.com");
  assert.equal(normalizeEntry("youtube.com"), "youtube.com");
  assert.equal(normalizeEntry("  reddit.com  "), "reddit.com");
  assert.equal(normalizeEntry("http://sub.example.com/path"), "sub.example.com");
});

test("normalizeEntry returns empty string for empty or unparseable input", () => {
  assert.equal(normalizeEntry(""), "");
  assert.equal(normalizeEntry("   "), "");
  assert.equal(normalizeEntry(null), "");
  assert.equal(normalizeEntry(undefined), "");
});

test("matchesList matches an entry exactly", () => {
  assert.equal(matchesList("youtube.com", ["youtube.com"]), true);
});

test("matchesList matches subdomains of an entry", () => {
  assert.equal(matchesList("m.youtube.com", ["youtube.com"]), true);
  assert.equal(matchesList("a.b.youtube.com", ["youtube.com"]), true);
});

test("matchesList does NOT match a look-alike domain (no false positive on substring)", () => {
  // "fake-youtube.com" ends with "youtube.com" as a raw string but is not
  // youtube.com or a subdomain of it — must not match.
  assert.equal(matchesList("fake-youtube.com", ["youtube.com"]), false);
  assert.equal(matchesList("notyoutube.com", ["youtube.com"]), false);
});

test("matchesList ignores empty/falsy entries in the list", () => {
  assert.equal(matchesList("youtube.com", ["", null, undefined, "youtube.com"]), true);
  assert.equal(matchesList("example.com", ["", null, undefined]), false);
});

test("activeBlockList returns the list matching the current mode, and [] when off", () => {
  assert.deepEqual(
    activeBlockList({ blockMode: BLOCK_MODE.BLACKLIST, blacklist: ["a.com"], whitelist: ["b.com"] }),
    ["a.com"]
  );
  assert.deepEqual(
    activeBlockList({ blockMode: BLOCK_MODE.WHITELIST, blacklist: ["a.com"], whitelist: ["b.com"] }),
    ["b.com"]
  );
  assert.deepEqual(activeBlockList({ blockMode: BLOCK_MODE.OFF, blacklist: ["a.com"] }), []);
});

test("isUrlBlocked: OFF mode never blocks", () => {
  assert.equal(isUrlBlocked("https://youtube.com", BLOCK_MODE.OFF, ["youtube.com"]), false);
});

test("isUrlBlocked: blacklist mode blocks listed sites and their subdomains only", () => {
  const list = ["youtube.com"];
  assert.equal(isUrlBlocked("https://youtube.com/watch", BLOCK_MODE.BLACKLIST, list), true);
  assert.equal(isUrlBlocked("https://m.youtube.com", BLOCK_MODE.BLACKLIST, list), true);
  assert.equal(isUrlBlocked("https://example.com", BLOCK_MODE.BLACKLIST, list), false);
});

test("isUrlBlocked: whitelist mode blocks everything except listed sites", () => {
  const list = ["wikipedia.org"];
  assert.equal(isUrlBlocked("https://wikipedia.org/wiki/Cat", BLOCK_MODE.WHITELIST, list), false);
  assert.equal(isUrlBlocked("https://youtube.com", BLOCK_MODE.WHITELIST, list), true);
});

test("isUrlBlocked never blocks ignored schemes even in whitelist mode", () => {
  assert.equal(isUrlBlocked("chrome://extensions", BLOCK_MODE.WHITELIST, ["wikipedia.org"]), false);
  assert.equal(isUrlBlocked("chrome-extension://self/options.html", BLOCK_MODE.WHITELIST, []), false);
});

test("isUrlBlocked treats www. and case differences as the same host", () => {
  assert.equal(isUrlBlocked("https://WWW.Youtube.com/", BLOCK_MODE.BLACKLIST, ["youtube.com"]), true);
});

test("isUrlBlocked fails safe (does not block) on an unparseable URL", () => {
  assert.equal(isUrlBlocked("not a url", BLOCK_MODE.BLACKLIST, ["youtube.com"]), false);
});
