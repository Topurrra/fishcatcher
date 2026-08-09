# FishCatcher

Browser extension that detects phishing-like URL patterns and explains the warning signs
in plain language — without blocking anything. Built for non-technical users.
Chrome + Brave first, Firefox second. English + Georgian.

Full product plan: [Plan.md](Plan.md)

## Development

No build framework — plain vanilla JS, two small Node scripts.

```sh
node scripts/make-icons.mjs   # regenerate placeholder icons (only when src changes)
node scripts/build.mjs        # stamp dist/chrome and dist/firefox from src/
node tests/verify.mjs         # invariant checks (run after build)
node scripts/package.mjs      # zip both targets for store submission (run after build)
```

- **Chrome / Brave:** `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chrome`
- **Firefox:** `about:debugging` → This Firefox → *Load Temporary Add-on* → `dist/firefox/manifest.json`

## Layout

- `src/manifest.json` — Chromium MV3 source of truth; Firefox variant is derived by `scripts/build.mjs`
- `src/background.js` — service worker (M0 placeholder; scoring engine lands in M1)
- `src/engine/` — (M1) pure-JS URL analysis, testable in Node
- `src/popup/`, `src/panel/`, `src/options/` — UI surfaces
- `src/data/` — (M1) bundled detection lists (safe list, brands, TLDs, keywords)
- `src/_locales/{en,ka}/` — i18n strings

## Store submission

- Zips: `dist/fishcatcher-chrome.zip` (Chrome Web Store, also Brave/Edge/Opera), `dist/fishcatcher-firefox.zip` (AMO)
- Listing copy: [store-listing.md](store-listing.md) — privacy policy: [privacy-policy.md](privacy-policy.md)
- Screenshots and promo tiles are a manual design step (see ROADMAP.md)

## Status

M0–M4 implemented. See Plan.md §9 for milestones and ROADMAP.md for deferred work.
