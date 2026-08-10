# FishCatcher transparency

FishCatcher warns you about phishing and scam sites. A warning tool is only worth trusting
if you can check how often it cries wolf, so we measure that and show the numbers.

## How it works

- It warns, it never blocks. You always decide.
- It runs on your device. The default checks need no internet.
- There is no server. Nothing about the page you are on reaches us, because there is
  nowhere for it to go.
- The online checks (threat-list updates, domain age, Google Safe Browsing) stay off until
  you turn them on, and each sends only the one domain it needs.

## What it looks for

- Brand impersonation: misspelled or look-alike versions of well-known sites.
- URL tricks: raw IP addresses, the @ trick, high-abuse endings, long subdomain chains,
  unencrypted logins, digit-heavy names.
- Known-bad lists: a bundled blocklist plus a daily community feed, matched on your device.
- Page checks: a login form on a site it does not know, and device-code sign-in scams.
- On-device model: spots the random, computer-generated addresses fresh phishing uses.
- AiTM: a sign-in or code prompt on a site whose address does not match the brand it looks
  like, with guardrails so real login providers do not trip it.
- Scam packs: pages asking for a wallet recovery phrase, and fake tech-support pages.
- Google Safe Browsing, if you add your own free key.

## False positives

A false positive is a warning on a site that is fine. The ones that matter are the loud
ones, high and critical, so that is what we count.

We run the address-only part of the engine over the Majestic Million (a public list of the
most-linked sites) and count how many good ones it warns about. The audit prints every site
it flagged, so you can check the number yourself:

```sh
node scripts/fp-audit.mjs
```

Latest run, 2026-08-11, over 100,000 legitimate sites:

| Measure | Value |
| --- | --- |
| Warnings at high | 5 |
| Warnings at critical | 0 |
| Rate | 0.005% (5 in 100,000) |

The five were all very short, digit-heavy names on high-abuse endings, like `hy315.cc`.

## Tests

The engine has an 83-check test suite that runs on every change, with phishing addresses
that must be caught and legitimate ones that must stay quiet.

## Found a mistake?

If FishCatcher warns about a good site, or misses a bad one,
[open an issue](https://github.com/Topurrra/fishcatcher-registry/issues). Real examples make
the lists and the model better for everyone.
