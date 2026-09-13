// Catches the two ways a _locales/<lang>/messages.json edit typically breaks
// silently: a locale drifting out of sync with which keys exist (en/ is the
// source of truth — every other locale must have exactly the same set), and
// a translated message whose $PLACEHOLDER$ substitutions don't match the
// English original (chrome.i18n.getMessage() would then get called with the
// wrong number/order of arguments for that locale).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "_locales");
const SOURCE_LOCALE = "en";

function loadMessages(locale) {
  const file = path.join(localesDir, locale, "messages.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

const locales = readdirSync(localesDir);

const source = loadMessages(SOURCE_LOCALE);
const sourceKeys = new Set(Object.keys(source));

let ok = true;

for (const locale of locales) {
  if (locale === SOURCE_LOCALE) continue;
  const messages = loadMessages(locale);
  const keys = new Set(Object.keys(messages));

  const missing = [...sourceKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !sourceKeys.has(k));
  if (missing.length) {
    ok = false;
    console.error(`[${locale}] missing keys: ${missing.join(", ")}`);
  }
  if (extra.length) {
    ok = false;
    console.error(`[${locale}] extra keys not in en: ${extra.join(", ")}`);
  }

  for (const key of sourceKeys) {
    if (!messages[key]) continue;
    const sourcePlaceholders = Object.keys(source[key].placeholders || {}).sort().join(",");
    const localePlaceholders = Object.keys(messages[key].placeholders || {}).sort().join(",");
    if (sourcePlaceholders !== localePlaceholders) {
      ok = false;
      console.error(
        `[${locale}] placeholder mismatch for "${key}": en has [${sourcePlaceholders}], ${locale} has [${localePlaceholders}]`
      );
    }
  }
}

if (!ok) {
  console.error("\nLocale check failed.");
  process.exit(1);
}
console.log(`All locales (${locales.join(", ")}) match ${SOURCE_LOCALE}'s keys and placeholders.`);
