# FishCatcher store submission notes

Reference for the Chrome Web Store and Firefox Add-ons review forms. Copy the
relevant text into each store's fields. Nothing here is user-facing.

Single purpose: **Warn people, in plain language, when a website shows signs of
phishing or malware, using on-device heuristics plus optional user-enabled checks.
It never blocks a page.**

No remote code. All logic is bundled in the package. The only thing fetched is a
JSON data file (the opt-in threat list); no executable code is ever downloaded.

## Permission justifications

Required:

- **storage** — save the user's settings (which optional features are on) and their
  trusted-site list, on the device only. No sync, no upload.
- **tabs** — read the URL of the active or updated tab so the current site can be
  scored and the toolbar icon updated on navigation.
- **activeTab** — read the address and page context of the tab the user is on for the
  on-demand checks (for example the right-click "Check QR code" action).
- **sidePanel** — the main interface on Chromium browsers is a side panel that shows
  the verdict and the reasons.
- **contextMenus** — adds the right-click "Check QR code" item on images.
- **alarms** — schedules the once-a-day threat-list refresh (only when the user turns
  that optional feature on).

Optional (requested only when the user enables the matching feature):

- **downloads**, **notifications** — the download guard checks a download's real file
  type against its name and shows a warning with a one-click cancel. Family mode also
  uses notifications to show a plain alert on a dangerous page.
- **https://rdap.org/**, **https://rdap.verisign.com/** — the opt-in domain-age check
  asks a public directory how old a domain is. It sends only the domain name.
- **https://raw.githubusercontent.com/** — downloads the opt-in threat-list file (a
  Bloom filter) from the FishCatcher registry. Download only, never upload.
- **https://safebrowsing.googleapis.com/** — the opt-in Google Safe Browsing check,
  using the user's own free API key.

Content script on `http(s)://*/*` (`probe.js`, at document idle): runs the on-page
checks on the site the user is viewing (detects a login/identity form, reads the page's
links and resource origins, detects device-code scam text, a wallet recovery-phrase
request, and fake tech-support scare text). It sends the worker only small derived facts
and hostnames, never page content, and everything is scored locally.

## Chrome data-use disclosure

- Personally identifiable information: **No**
- Health information: **No**
- Financial and payment information: **No**
- Authentication information: **No** (the extension detects the presence of a password
  field to raise a warning, but never reads or transmits credentials)
- Personal communications: **No**
- Location: **No**
- Web history: the extension processes the current page's URL **locally** to score it;
  it is not collected or transmitted by default. Two optional, off-by-default features
  send data to third parties only after the user enables them: the domain-age check
  sends the domain name to rdap.org, and the Google Safe Browsing check sends the URL to
  Google using the user's own key. No browsing data is ever sent to the developer (the
  project runs no server).
- User activity: **No**
- Website content: the extension reads the current page's DOM locally to detect
  forms/links; that data stays on the device and is not transmitted.

Certifications:
- Not being sold or transferred to third parties, except the opt-in third-party lookups
  the user explicitly enables (rdap.org, Google Safe Browsing).
- Not used or transferred for purposes unrelated to the single purpose above.
- Not used or transferred to determine creditworthiness or for lending.

## Privacy policy URL

Point both stores at `https://fishcatcher.dev/privacy` once the site is live.

## Listing copy

Draft name, short description, full description, category and screenshots live in
`docs/store-listing.md`. Store icon is `src/icons/icon128.png`; the toolbar icon shows
the risk color plus a badge.
