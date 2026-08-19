# Changelog

All notable changes to Fish Catcher are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match the
extension's manifest version.

## [Unreleased]

### Added

- "Open the real site" button in the panel and the warning banner: when a page
  impersonates a known brand, one tap opens the brand's genuine site instead.
- Just-in-time nudge: on a high-risk page the warning banner now also appears
  the first time a password or one-time-code field gains focus, even without
  strict mode. Still never blocks.
- First-run welcome page after install: the four risk colors, how to open the
  panel, and a link to the live demo at fishcatcher.dev/demo.
- Form-action signal: a password or code form that posts to a foreign domain,
  a raw IP, or a known exfiltration endpoint now raises the score.
- Recall benchmark (`scripts/recall-audit.mjs`) over ~390k live phishing hosts,
  published on the site next to the false-positive rate.
- Full public suffix list (~9,000 rules, wildcard and exception rules included)
  instead of the hand-picked 145-entry subset.

### Changed

- ML model v2: hashed character n-gram model over the full hostname. Zero false
  positives on the top 100k sites; any-signal recall up from 33% to 73%.
- Threat-list bundles are now signed (ES256, pinned public key) and may only
  add threat data; an unsigned or tampered bundle is refused.

### Fixed

- Popup: wider layout, action buttons wrap instead of overflowing.
- Device-code matcher requires a real code on the page and skips lessons and
  known-good sites.

## [1.0.0] - 2026-08-19

Initial store submission.

- On-device phishing analysis of every page: lookalike domains, brand
  misspellings, homoglyphs, high-abuse TLDs, phishing keywords, raw IPs and
  other address signals combined into one score and four colors. Warns, never
  blocks; nothing leaves the browser by default.
- Page probe: password and one-time-code forms, AiTM sign-in pages, device-code
  scams, crypto seed-phrase and tech-support scam packs, link intelligence.
- QR code checks (right-click an image, upload a file, or use the camera),
  fully local.
- Side panel on Chromium, popup and sidebar on Firefox; strict-mode banner,
  trusted sites, family mode with helper email, download guard.
- Opt-in extras, all off by default: signed threat-list updates, RDAP domain
  age, Google Safe Browsing with the user's own key.
- English and Georgian locales; free and MIT licensed.
