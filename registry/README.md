# FishCatcher registry

This folder is the source for the
[fishcatcher-registry](https://github.com/Topurrra/fishcatcher-registry) repository,
which feeds threat-list updates to the FishCatcher extension.

## How it works

1. A GitHub Action runs every day (`.github/workflows/update.yml`).
2. It runs `build-feed.mjs`, which downloads several free, redistributable
   malicious-domain feeds, merges the hostnames, and packs them into a Bloom filter.
   If one feed is temporarily down, the others still build.
3. The result is committed as `fishcatcher-lists.json` at the repo root, but only when it
   changed.
4. The extension fetches that file once a day, using an ETag so it downloads only on change.
   The URL is set in the extension at `src/background.js` (`DEFAULT_REMOTE_URL`).

A Bloom filter lets roughly 400,000 domains ship in under a megabyte. Membership is
probabilistic, so about 0.3% of lookups can be false positives. That is why FishCatcher
only warns and never blocks, and why safe-listed and user-trusted domains are checked
before the feed.

No servers, no secrets, no human step. Setup is one time.

## One-time setup

Copy this folder's contents into the empty `fishcatcher-registry` repo and push:

```sh
git clone https://github.com/Topurrra/fishcatcher-registry.git
cp -r registry/. fishcatcher-registry/
cd fishcatcher-registry
node build-feed.mjs          # optional: build the first list locally
git add .
git commit -m "Set up daily phishing feed"
git push
```

Then open the repo on GitHub, go to the Actions tab, and enable workflows if prompted.
From then on it updates itself.

## Sources

All keyless and redistributable:

- [Phishing.Database](https://github.com/Phishing-Database/Phishing.Database) (MIT) — active phishing domains
- [URLhaus](https://urlhaus.abuse.ch/) by abuse.ch — malware host file
- [OpenPhish](https://openphish.com/) community feed — phishing URLs

No API keys are involved. The lists are checked locally in the extension, so nothing about
the user is sent anywhere.
