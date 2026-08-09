# FishCatcher — Privacy Policy

FishCatcher is a local-first browser extension. This policy is written to be
paste-ready for the Chrome Web Store and Mozilla Add-ons listings.

**Verifiable by design:** FishCatcher is open source (MIT). Anyone can read the
code, and the network behavior can be verified in DevTools: during normal use
the extension makes zero network requests unless the optional list-update
feature is explicitly enabled.

## What we collect

**Nothing.** FishCatcher does not collect, store, transmit, or share any
personal data, browsing history, or usage statistics. There is no analytics,
no telemetry, no advertising, and no third-party SDKs.

## How the extension works

- The URL of the tab you are currently viewing is analyzed **inside your
  browser** by a local pattern-matching engine. The URL never leaves your
  device.
- Detection data (lists of known legitimate domains, protected brand names,
  high-abuse domain endings, and common phishing keywords) ships inside the
  extension package.
- Sites you explicitly mark as trusted ("Trust this site") are stored only in
  your browser's local extension storage. They are never uploaded.

## Optional remote list updates

If — and only if — you enable it in the extension's options page and provide a
URL, the extension downloads a JSON file with updated detection lists from
that URL. This is a plain download: no personal data, URLs, or identifiers are
sent to the server. If the download fails, the bundled lists keep working.
The feature is **off by default**.

## Permissions explained

| Permission | Why |
|---|---|
| `storage` | Remember your settings and locally-trusted sites |
| `tabs` | Read the URL of the tab you are viewing, to analyze it |
| `scripting` + `activeTab` | Show the optional, dismissible warning banner (strict mode, off by default) |
| `sidePanel` (Chromium only) | Open the information panel |

## Data deletion

All locally stored data (settings, trusted sites) is removed when you uninstall
the extension.

## Changes to this policy

Changes will be published in the store listing before the updated version
ships.

## Contact

Report concerns through the store listing's support channel.
