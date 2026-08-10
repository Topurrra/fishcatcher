# FishCatcher

FishCatcher watches the website you are on and warns you when it looks like phishing
or a scam. It explains the warning signs in plain language, it never blocks a page,
and it never sends your browsing anywhere. It is built for people who are not
security experts.

Works on Chrome, Brave, Edge and Opera, plus Firefox. Available in English and Georgian.

## What it does

- Checks the page you are visiting for common phishing tricks: fake login pages,
  lookalike domains, confusing links, and known bad sites.
- Colors the toolbar icon green, yellow, orange, or red so you see the risk at a glance.
- Tells you why a site looks risky in a sentence or two, so you learn to spot it yourself.
- Checks QR codes before you trust them. Right click any QR image and pick "Check this QR code".
- Runs fully on your device. No account, no tracking, nothing from the page leaves your browser.

## Install

FishCatcher will be published on the Chrome Web Store and Firefox Add-ons. Store links
will go here once it is live. To try it now, see [Build from source](#build-from-source).

## Your privacy

FishCatcher does its checks locally, using lists bundled inside the extension. It works
with no internet connection.

Two optional features can look something up online, and both stay off until you turn them on:

- **Threat list updates:** downloads a fresh list of known phishing sites. It only
  downloads, it never uploads.
- **Domain age check:** asks a public WHOIS service how old a domain is. It sends only
  the domain name and nothing else.

Leave both off and the extension still protects you.

## Automatic threat updates

The list of known phishing sites stays current with no manual work. A companion
repository, [fishcatcher-registry](https://github.com/Topurrra/fishcatcher-registry),
rebuilds the list every day from the community feed at
[Phishing.Database](https://github.com/Phishing-Database/Phishing.Database) and publishes
it as a single compact file. When you turn on threat list updates, the extension fetches
that file once a day, and only when it has changed.

The automation is in [`registry/`](registry/). See [registry/README.md](registry/README.md)
to set it up.

## Free and open source

FishCatcher is MIT licensed (see [LICENSE](LICENSE)) and free to use forever. The privacy
promise above is one you can verify by reading this source. Bundled third party code is
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
  and pick `dist/firefox/manifest.json`.
