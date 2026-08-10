# FishCatcher roadmap

Status: **v1.0.0, feature-complete, preparing for store submission.**
83/83 checks green, both builds passing.

FishCatcher's identity guides every item here: warn, never block; explain in plain
language; run on-device by default; teach while it protects; free and open forever.

## Shipped (v1.0)

**Detection engine (all on-device, works with no internet):**

- Brand impersonation: misspelling / edit-distance (S1), look-alike character / IDN
  homoglyph (S2), brand name on a non-brand domain (S3).
- URL shape: raw IP host (S4), `@` trick (S5), high-abuse TLD (S6), phishy keywords (S7),
  deep subdomain chains (S8), unencrypted login (S9), digit/hyphen soup (S10), short
  random names (S11).
- Known-bad: bundled blocklist (S12) plus the community threat feed as a Bloom filter (S16).
- Page probes: a login form on an unknown domain (S13), device-code scam text (S14).
- On-device ML (S17): a lexical logistic-regression model that flags
  algorithmically-generated domain names, catching threats no rule matches.
- AiTM (S/M8): an identity flow (login, MFA, passkey enrollment, device code) on an origin
  that does not match the claimed brand, with guardrails so enterprise proxies and real
  identity providers never false-alarm.
- Scam packs: a crypto wallet seed-phrase or private-key request, and fake tech-support
  browser-locker pages (scare text plus a phone number or a full-screen lock).
- Known-legitimate allowlist (top 100k domains) keeps the high/critical false-positive
  rate near 0.005%.
- Optional, off by default: RDAP domain-age check (S15), Google Safe Browsing with the
  user's own key (S18).

**Product:**

- Warn-never-block, color-coded toolbar icon and a pixel-fish verdict mascot, plain
  language reasons for every warning.
- Side panel on Chrome / Brave / Edge / Opera, popup on Firefox, plus an options page.
- Link intelligence: link-text-vs-destination mismatch, disguised downloads, shorteners,
  and an on-demand deep scan of every link.
- QR-code check (image file or camera), fully local.
- Download guard (opt-in): warns about disguised or dangerous downloads, one-click cancel.
- Family mode: a bigger, simpler view, a clear alert on dangerous sites, and an optional
  one-tap email to a helper (no server; the user still presses send).
- Report this site: opens a pre-filled community report; a maintainer confirms it before
  it reaches the feed.
- Strict-mode in-page banner, trusted-sites list, and live progress feedback.

**Systems:**

- Daily keyless threat registry that merges Phishing.Database, URLhaus, and OpenPhish into
  one Bloom filter, ETag-cached and fetched only on change. Hardened with fetch timeouts
  and retries, a drop guard against bad rebuilds, and write-back validation.
- Human-gated community-report loop: reports become issues, a maintainer labels the real
  ones, and those domains flow into the next feed rebuild.
- Reproducible false-positive audit ([scripts/fp-audit.mjs](scripts/fp-audit.mjs)) and a
  public [TRANSPARENCY.md](TRANSPARENCY.md) with the measured rate.
- Zero-dependency vanilla-JS build, Manifest V3, minimal permissions (network permissions
  requested only when an opt-in feature is turned on), an 83-check test suite.
- The [fishcatcher.dev](https://fishcatcher.dev) site: landing, docs, education, privacy.

## Before launch

- Screenshots and promo tiles, store listing copy, developer accounts.
- Full live click-through of the loaded extension in Chrome and Firefox.
- Submit to the Chrome Web Store and Firefox Add-ons, then Edge / Opera (same build).

## Planned (next)

- More languages. Georgian is staged behind an English-only launch flag; Russian, Spanish
  and others follow (the i18n scaffolding is ready).
- Right-click "Check this link" on any link.
- Warning history and a "what you learned" view (education and trust).
- Signed update bundles for feed integrity.
- More scam packs: romance and investment scams, fake delivery and invoice pages.

## Exploring (future)

- Security-scoped blocking (opt-in): block known malware, phishing, scam and cryptomining
  domains via declarativeNetRequest, sourced from the registry. Not a general ad blocker
  (see the note below).
- Tracker awareness: count and explain the third-party trackers on a page, with optional
  blocking of known trackers.
- Visual / logo similarity detection (needs a model-size budget).
- AiTM Signal 3: cross-origin auth-flow continuity (needs host permissions).
- Email and webmail link scanning (Gmail, Outlook on the web).
- Phishing school: short interactive lessons and practice.
- Mobile (Firefox for Android first).
- Enterprise-lite: policy-pushed allowlists for managed deployments.

## A note on ad and tracker blocking

FishCatcher will not try to be a general ad blocker. That is a crowded, mature space
(uBlock Origin, AdGuard, Brave), Manifest V3 makes it weaker than uBO on Firefox, and
"warn, never block" is core to what FishCatcher is. Where blocking fits the brand is
**security-scoped**: opt-in blocking of known malware / scam / phishing / cryptomining
domains, sourced from the same registry automation. That is protection, not ad blocking,
and it keeps the product focused.
