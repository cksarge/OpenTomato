// Single place to set the Chrome Web Store listing URL once OpenTomato is
// published there. Every "Add to Chrome" button on the site (marked with
// data-store-link) reads from this one value — just paste the URL below and
// both pages update automatically, no need to hunt through the HTML.

window.OPENTOMATO_CHROME_STORE_URL = "https://chromewebstore.google.com/detail/opentomato-%E2%80%93-pomodoro-foc/ccljdblofkpblglflfdkeebjplncgifp"; // e.g. "https://chromewebstore.google.com/detail/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

// Which version's privacy policy /privacy.html shows when the URL has no
// #version fragment — i.e. the version that's actually live on the Chrome Web
// Store. privacy.html looks for website/privacy-policy-X-Y-Z.md (dots become
// dashes), so this must match a file that exists.
//
// Bump this the moment a new version goes live and nothing else needs to
// change — the new version's file becomes the default immediately. Every
// version's policy stays reachable forever at its own URL regardless of this
// value: privacy.html#1.0.0, privacy.html#1.1.0, etc. That's what makes it
// safe to point the Chrome Web Store's privacy policy field at a not-yet-live
// version's #-URL while it's pending review, without disturbing what's shown
// to current users.
window.OPENTOMATO_PRIVACY_VERSION = "1.0.0";

document.addEventListener("DOMContentLoaded", function () {
  var url = window.OPENTOMATO_CHROME_STORE_URL;
  if (!url) return; // still unset — leave the placeholder buttons as-is

  document.querySelectorAll("[data-store-link]").forEach(function (el) {
    el.href = url;
    el.target = "_blank";
    el.rel = "noopener";
  });
});
