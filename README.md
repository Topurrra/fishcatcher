<p align="center">
  <img src="assets/wordmark.gif" alt="Fish Catcher" width="480">
</p>

FishCatcher watches the website you are on and warns you when it looks like phishing
or a scam. It explains the warning signs in plain language, it never blocks a page,
and it never sends your browsing anywhere. It is built for people who are not
security experts.

Works on Chrome, Brave, Edge and Opera, plus Firefox. English at launch, more languages coming.

## What it does

- Checks the page you are visiting for common phishing tricks: fake login pages,
  lookalike domains, confusing links, and known bad sites.
- Catches brand-new scams too. A small on-device model spots the random,
  computer-generated web addresses that fresh phishing sites use, and it flags a login
  or code prompt that appears on a site pretending to be a brand it is not.
- Spots specific scam types: a page that asks you to type your crypto wallet recovery
  phrase or private key, and fake "your computer is infected, call this number"
  tech-support pages.
- Colors the toolbar icon green, yellow, orange, or red so you see the risk at a glance.
- Tells you why a site looks risky in a sentence or two, so you learn to spot it yourself.
- Checks QR codes before you trust them. Right click any QR image and pick "Check this QR code".
- Flags links whose visible text does not match where they really go, and warns about shortened links that hide their destination.
- Optional download guard: warns when a download is disguised, like a program pretending to be a PDF, with a one-click cancel.
- Family mode: bigger text, a clear alert on dangerous sites, and an optional one-tap email to a helper you choose. Nothing is sent until you press send.
- Report this site: one button opens a ready-made report, so a risky site can be added to the shared threat list after a person reviews it.
- Runs fully on your device. No account, no tracking, nothing from the page leaves your browser.

On Chrome, Brave, Edge and Opera the toolbar icon opens a side panel. On Firefox it opens a popup.

## Install

FishCatcher will be published on the Chrome Web Store and Firefox Add-ons. Store links
will go here once it is live. To try it now, see [Build from source](#build-from-source).

## Your privacy

FishCatcher does its checks locally, using lists bundled inside the extension. It works
with no internet connection.

A few optional features can look something up online, and each stays off until you turn it on:

- **Threat list updates:** downloads a fresh list of known phishing sites. It only
  downloads, it never uploads.
- **Domain age check:** asks a public directory (RDAP) how old a domain is. It sends only
  the domain name and nothing else.
- **Google Safe Browsing:** checks a link against Google's list using your own free API
  key. Off by default, and there is a short guide for getting a key if you want it.

Leave them all off and the extension still protects you. Nothing is ever sent to us, because
there is no server: FishCatcher runs no backend of its own.

## Transparency

A warning tool is only worth trusting if you can check how often it is wrong. We measure
that and publish it. On the top 100,000 legitimate websites, fewer than 0.01% get a high
or critical warning (5 in 100,000, a rate of 0.005%). The audit is reproducible with one
command, `node scripts/fp-audit.mjs`, and it prints every site it flagged so the number is
not something you have to take on faith. See [fishcatcher.dev/transparency](https://fishcatcher.dev/transparency).

## Automatic threat updates

The list of known phishing sites stays current with no manual work. A companion
repository, [fishcatcher-registry](https://github.com/Topurrra/fishcatcher-registry),
rebuilds the list every day from three open community feeds,
[Phishing.Database](https://github.com/Phishing-Database/Phishing.Database), URLhaus, and
OpenPhish, and publishes them merged into a single compact file. No API keys are needed.
When you turn on threat list updates, the extension fetches that file once a day, and only
when it has changed. Every list is signed by the registry and the extension checks the
signature against a key built into it before using the list, so a tampered file is ignored.

The automation lives in the [fishcatcher-registry](https://github.com/Topurrra/fishcatcher-registry)
repository; its README explains the setup and the signing key.

## Free and open source

FishCatcher is MIT licensed (see [LICENSE](LICENSE)) and free to use forever. What it does
with your data (above) you can verify by reading this source. Bundled third party code is
listed in [src/vendor/NOTICE.md](src/vendor/NOTICE.md).

## Build from source

Plain vanilla JavaScript, no framework, just two small Node scripts.

```sh
node scripts/build.mjs      # build dist/chrome and dist/firefox from src/
node tests/verify.mjs       # sanity checks (run after build)
node scripts/package.mjs    # zip both builds for the stores (run after build)
```

Then load it:

- **Chrome, Brave, Edge, Opera:** open the extensions page, turn on Developer mode,
  choose Load unpacked, and pick `dist/chrome`.
- **Firefox:** open `about:debugging`, choose This Firefox, Load Temporary Add-on,
  and pick `dist/firefox/manifest.json`. Firefox 128 or newer (Chrome family: 116 or newer).
