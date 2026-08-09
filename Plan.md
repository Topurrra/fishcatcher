# FishCatcher — Phishing Pattern & URL Risk Checker

> A browser extension that analyzes the page you're on for phishing-like URL patterns,
> warns you with plain-language explanations, and **never blocks** anything.
> Built for non-technical people: it teaches while it protects.

**Targets:** Chrome + Brave first (identical Chromium build), Firefox second.
**Languages:** English + Georgian (ქართული) from day one.
**Ethos:** local-first — analysis runs entirely in the browser. No data leaves the machine.

---

## 1. Core Principles

| Principle | Meaning |
|---|---|
| **Warn, never block** | No redirects, no interception. User always decides. Avoids liability and store-policy issues. |
| **Explain, don't alarm** | Every warning names *why*: "domain looks like a misspelling of microsoft.com". |
| **Local-first** | v1 scoring needs zero network calls. Optional list updates are opt-in and fetch only a JSON file. |
| **Minimal permissions** | No `<all_urls>`, no browsing-history reads beyond the current tab's URL. |
| **Honest capability** | Never "this site is phishing" or "100% safe". Always "shows signs of…". |

---

## 2. How It Works (Pipeline)

1. **Trigger** — background service worker listens to `chrome.tabs.onUpdated`. Every finished page load is scored. (Popup re-scores on demand.)
2. **Parse** — extract the URL, decode punycode, normalize homoglyphs, find the **registrable domain (eTLD+1)** using the Public Suffix List — never naive "last two labels" (breaks on `.co.uk`, `.com.ge`, etc.).
3. **Score** — run the signal engine (§3) against bundled data lists (§4).
4. **Surface** — badge color on the toolbar icon + popup details + (opt-in strict mode) in-page banner on High/Critical.
5. **Store** — per-site user decisions ("Trust this site") in `chrome.storage.local` only.

---

## 3. Detection Engine — Signals

Each signal has a weight and a human-readable reason string. Signals are capped and combined into a 0–100 score.

### Trust short-circuit
Registrable domain is on the bundled **Safe List** (top ~500 popular domains) → score 0, green, done. User-trusted sites behave the same.

### Red-flag signals

| # | Signal | What it catches | Weight |
|---|---|---|---|
| S1 | **Brand impersonation** | eTLD+1 or full host within Levenshtein distance ≤2 of a **Protected Brand** (microsoft, paypal, google, bank names…) but *not* the real domain | 45 |
| S2 | **Homoglyph / IDN attack** | Mixed scripts or confusable characters (Cyrillic `а` in `pаypal.com`); punycode host decoding to visually identical brand names | 45 |
| S3 | **Brand keyword + wrong owner** | Host contains a brand name as subdomain/path (`login.microsoft.com.evil.ru`) — brand present but eTLD+1 is not the brand's | 40 |
| S4 | **IP address URL** | `http://185.22.64.3/login` — legitimate sites almost never do this | 35 |
| S5 | **`@` trick in URL** | `https://paypal.com@evil.com` — everything before `@` is ignored by browsers | 35 |
| S6 | **Suspicious TLD** | `.tk .ml .ga .cf .gq .xyz .top .icu .click .zip …` (configurable list) | 15 |
| S7 | **Phishy keywords in host** | `secure-, verify-, account-, -login, -update, -wallet, confirm-` combined with brand-adjacent words | 15 |
| S8 | **Deep subdomain chain** | ≥4 labels (`login.secure.account.update.evil.com`) | 10 |
| S9 | **HTTP on a form/login page** | No TLS where credentials could be entered | 15 |
| S10 | **Excessive digits/hyphens** | `pay-pa1-secure-2026.com` style generated domains | 10 |
| S11 | **Very short / random domain** | `a1b2c3.com`, `qxzw.net` (low weight alone) | 5 |

### Risk levels (displayed — never raw percentages as "similarity")

| Score | Level | Badge | Meaning shown to user |
|---|---|---|---|
| 0–19 | 🟢 Low | green | "No suspicious signs found." |
| 20–44 | 🟡 Elevated | yellow | "Some unusual signs. Double-check the address." |
| 45–74 | 🟠 High | orange | "Multiple phishing indicators — be careful before logging in." |
| 75+ | 🔴 Critical | red | "Strong phishing signs. Don't enter passwords here." |

The popup always lists the **named reasons** ("Domain looks like a misspelling of `microsoft.com`", "Uses a free high-abuse TLD (.tk)"). This is the educational core — no fake-precision "78% similarity" claims.

---

## 4. Data Lists (bundled JSON, versioned)

| File | Content |
|---|---|
| `data/safe-list.json` | ~500 curated legitimate registrable domains (google.com, microsoft.com, tbcbank.ge, bog.ge…) |
| `data/brands.json` | Protected brand names + their real domains (basis for S1/S2/S3 similarity) |
| `data/tlds.json` | Suspicious-TLD list with per-TLD weights |
| `data/keywords.json` | Phishy keyword patterns |

Each file carries a `version` field. **Optional remote update:** if the user enables it in Options, the extension fetches a single signed/`ETag`-cached JSON bundle from a user-configured URL, never sends anything. Default = off, bundled lists only.

> Note vs. original plan: typo variants like `micr0soft.com` do **not** belong in a whitelist — they're caught automatically by S1/S2 similarity matching against `brands.json`. No hand-maintained misspelling list needed.

---

## 5. User Experience (for non-technical users)

### Toolbar badge (always on, passive protection)
Icon badge color = risk level of the current tab. Green by default; users learn "orange = stop and think".

### Popup (click the icon)
- Big status card: level color, one plain-language sentence.
- **"Why am I seeing this?"** — bullet list of matched signals in human terms.
- Buttons: **"Trust this site"** (whitelists the registrable domain locally) / **"Check again"**.
- Tip of the day (rotating anti-phishing education snippet, EN/KA).

### Strict mode (opt-in, default off)
On High/Critical scores, inject a dismissible top banner into the page via content script:
> ⚠️ FishCatcher: this page shows signs of a fake site (looks like `microsoft.com`). Don't enter passwords unless you're sure. [Details] [Dismiss]
Never blocks, never covers page content entirely, always dismissible.

### Options page
Strict mode toggle, remote list updates toggle + URL, safe-list viewer, "untrust" management, language (follows browser; manual override EN/KA).

### i18n
Chrome `_locales/{en,ka}/messages.json` structure from day one. All UI strings via `chrome.i18n.getMessage` — no hard-coded text.

---

## 6. Cross-Browser Strategy (MV3)

Shared 100% vanilla JS source (no build framework — same convention as ToolKit & KeepItLocal Memory extensions). A tiny `scripts/build.mjs` stamps two variants from one source tree:

| | Chrome / Brave | Firefox |
|---|---|---|
| Manifest | `manifest.json` (MV3, `background.service_worker`, `side_panel`) | Generated variant: `background.scripts` (event page), `sidebar_action` instead of `side_panel` |
| UI surface | Popup + side panel (resizable, like ToolKit) | Popup + sidebar |
| APIs | `chrome.*` | `chrome.*` (Firefox MV3 supports it; `browser.*` polyfill only where needed) |

Side panel/sidebar share one `panel.html`; popup is a compact version of the same status card.

**Minimal permissions (both):** `storage`, `tabs` (needed for auto-badge on navigation), `scripting` + `activeTab` (strict-mode banner injection), `contextMenus` (right-click "Check this link"). `host_permissions` only for the optional update endpoint, added only when the user enables it.

---

## 7. Project Structure

```
FishCatcher/
├── manifest.json              # Chromium variant
├── scripts/build.mjs          # stamps dist/chrome + dist/firefox
├── src/
│   ├── background.js          # service worker: scoring on tab update, badge
│   ├── engine/
│   │   ├── analyzer.js        # pure functions: url → {score, level, reasons[]}
│   │   ├── signals.js         # S1–S11 implementations
│   │   ├── punycode.js        # decode + homoglyph normalize
│   │   └── psl.js             # Public Suffix List lookup (bundled subset)
│   ├── data/                  # safe-list.json, brands.json, tlds.json, keywords.json
│   ├── popup/ (popup.html/js/css)
│   ├── panel/ (panel.html/js/css)   # side panel / sidebar
│   ├── options/
│   ├── banner/content.js      # strict-mode banner content script
│   └── _locales/en, ka/
├── icons/
├── tests/                     # node:test — engine is pure JS, testable headless
│   └── verify.mjs             # one-command suite (pattern from KeepItLocal Memory)
└── Plan.md, README.md
```

The engine has **zero extension-API dependencies** → unit-testable in plain Node: `node tests/verify.mjs` over a corpus of real phishing examples + legitimate URLs (false-positive guard).

---

## 8. Wording & Compliance Rules (non-negotiable)

- ❌ Never "This site is phishing." → ✅ "This site shows signs commonly seen in phishing."
- ❌ Never "100% safe / accurate." → ✅ "No suspicious signs found — but always stay alert."
- ❌ Never block, redirect, or modify page content (banner is informational + dismissible).
- ✅ Store listing states clearly: heuristic pattern analysis, local-only, no guarantees.
- ✅ If AI/external data is ever added, disclose it in-product.

---

## 9. Milestones

| Milestone | Deliverable | Verified by |
|---|---|---|
| **M0** Scaffold | Repo structure, both manifests, build script, placeholder icon/popup | `dist/chrome` loads unpacked in Chrome & Brave |
| **M1** Engine | analyzer + all signals + data lists + psl/punycode | `node tests/verify.mjs`: ≥ corpus of phishing URLs score High/Critical, top-100 legit domains score 0 |
| **M2** Passive protection | background scoring + badge + popup with reasons + trust action | Manual browse: typosquat test domains turn badge orange/red |
| **M3** UX complete | strict-mode banner, options, side panel, EN+KA _locales | Non-technical person test: can they explain the warning back? |
| **M4** Firefox | Firefox manifest variant + sidebar + store-ready packaging | Loads as temporary add-on in Firefox, same corpus passes |
| **M5** Release | Chrome Web Store + AMO listings, privacy policy text, screenshots | Published |

### End-to-end verification (every milestone)
1. `node tests/verify.mjs` — engine corpus green.
2. Load unpacked in Chrome → visit crafted test URLs (`http://1.2.3.4/login`, `paypa1.com`, `login.microsoft.com.evil.xyz`) → correct badge + reasons.
3. Visit google.com/microsoft.com/bank sites → green, zero false positives.

---

## 10. Roadmap (post-v1, deferred)

- Google Safe Browsing API integration (free tier, opt-in, disclosed)
- PhishTank / community phishing feeds via the remote-update channel
- Warning history & "what you learned" stats
- Signed update bundles + your own update endpoint hosting
- Edge / Opera packaging (Chromium build, mostly store paperwork)
- In-product education module ("Phishing school" mini-lessons)
