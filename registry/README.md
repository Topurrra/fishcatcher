# FishCatcher registry

This folder is the source for the
[fishcatcher-registry](https://github.com/Topurrra/fishcatcher-registry) repository,
which feeds threat-list updates to the FishCatcher extension.

## How it works

1. A GitHub Action runs every day (`.github/workflows/update.yml`).
2. It gathers any maintainer-confirmed community reports (see below) into a local
   `community-reports.txt`, then runs `build-feed.mjs`, which downloads several free,
   redistributable malicious-domain feeds, merges the hostnames (feeds plus the local
   reports), and packs them into a Bloom filter. If one feed is temporarily down, the
   others still build.
3. The result is committed as `fishcatcher-lists.json` at the repo root, but only when it
   changed.
4. The extension fetches that file once a day, using an ETag so it downloads only on change.
   The URL is set in the extension at `src/background.js` (`DEFAULT_REMOTE_URL`).

A Bloom filter lets roughly 400,000 domains ship in under a megabyte. Membership is
probabilistic, so about 0.3% of lookups can be false positives. That is why FishCatcher
only warns and never blocks, and why safe-listed and user-trusted domains are checked
before the feed.

No servers. The one secret is the feed signing key (below). The only recurring human step
is a maintainer confirming community reports. Setup is one time.

## Signed lists

Every published `fishcatcher-lists.json` carries a `sig` field: an ECDSA P-256 / SHA-256
signature (raw r||s, base64) over the fields `version, generated, sources, count, bloom`
in that order. The extension pins the matching public key in `src/data/registry-key.json`
and refuses a list whose signature is missing or wrong, so a compromised registry repo,
CDN or man-in-the-middle cannot push a tampered list to opted-in users. A bundle can also
only add threat data: the extension ignores anything that would touch its safe list,
brands or weights.

The private key lives only in the repository secret `FEED_SIGNING_KEY` (PKCS8 PEM) and in
the maintainer's password manager. CI refuses to publish when the secret is missing. To
rotate: generate a new P-256 key, ship the new public key in the extension first, then swap
the secret.

## Report loop (community reports, human-gated)

Anyone can report a suspicious site without being technical:

1. A visitor opens a "Report a suspicious site" issue using the friendly form at
   `.github/ISSUE_TEMPLATE/report-site.yml`. New reports get the `community-report` label
   automatically.
2. A maintainer reviews the report. If it is a real scam, they add the `confirmed-phish`
   label. That label is the gate: only a human can apply it, so reports cannot poison the
   feed on their own.
3. On the next run, the workflow reads the "Website address" from every `confirmed-phish`
   issue (open or closed), strips it down to a bare hostname, and writes
   `community-reports.txt`. `build-feed.mjs` merges that file like any other source.

To drop a confirmed domain later, remove the `confirmed-phish` label from its issue. It
leaves the list on the next rebuild.

Create both labels once in the repo (Issues -> Labels): `community-report` and
`confirmed-phish`. Without them the form still works, but the labels will not attach.

## Robustness

The automation is built so a bad run cannot ship a broken list:

- Feed downloads have a per-request timeout and a couple of retries, so one slow feed
  cannot hang the build. A feed that is fully down is skipped and the rest still build.
- Hard floor: if the merged set is under 1000 hosts, the build refuses to overwrite.
- Drop guard: if a rebuild falls under 60% of the last good count, it refuses to overwrite
  the previous list. Re-run `node build-feed.mjs --force` (or set `FORCE_REBUILD=1`) if the
  drop is real.
- After writing, the build re-reads and re-parses the JSON, so a truncated write fails the
  run instead of shipping.
- The workflow uses `concurrency` so a scheduled run and a manual run cannot race the push,
  a job `timeout-minutes`, and least-privilege permissions (`contents: write` to push,
  `issues: read` for the report loop).

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

- [Phishing.Database](https://github.com/Phishing-Database/Phishing.Database) (MIT): active phishing domains
- [URLhaus](https://urlhaus.abuse.ch/) by abuse.ch: malware host file
- [OpenPhish](https://openphish.com/) community feed: phishing URLs
- `community-reports.txt`: local file, built from issues a maintainer labeled
  `confirmed-phish` (see the report loop above). Rebuilt each run and never committed.

Triage labels: `community-report` (added to every new report by the form) and
`confirmed-phish` (added by a maintainer once a report is verified; this is what puts a
domain into the list).

No API keys are involved. The lists are checked locally in the extension, so nothing about
the user is sent anywhere.
