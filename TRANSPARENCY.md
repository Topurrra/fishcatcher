# FishCatcher transparency

FishCatcher warns you about phishing and scam sites. A warning tool is only worth
trusting if you can check what it does and how often it gets things wrong. This page
explains our promises, what we look for, and how anyone can measure our false alarms
for themselves.

## Our promises

- **We warn, we never block.** FishCatcher shows you a warning and explains it. It
  never stops a page from loading and never decides for you.
- **On-device by default.** Every default check runs inside your browser, using lists
  bundled in the extension. It works with no internet connection.
- **No server.** There is no FishCatcher backend. Nothing about the page you are on is
  ever sent to us, because there is nowhere for it to go.
- **Opt-ins are off until you turn them on.** A few features can look something up
  online (threat list updates, domain age, Google Safe Browsing with your own key).
  Each one is off by default, and each only sends the one domain name it needs.

## What we detect

FishCatcher looks for several families of warning signs. Most run on-device on every
site. A couple are opt-in and stay off until you enable them.

- **Brand impersonation.** Misspelled or look-alike versions of well-known sites, and a
  brand name placed on a domain the brand does not own.
- **URL shape.** Web address tricks: a raw IP address, the `@` trick, high-abuse
  domain endings, phishy words, long subdomain chains, an unencrypted login page, and
  digit or hyphen heavy names.
- **Known-bad feeds.** A bundled blocklist, plus a daily community threat feed of known
  phishing sites, matched locally.
- **Page probes.** A login form on a site we do not recognize, and text that walks you
  through a device-code sign-in scam.
- **On-device ML.** A small lexical model that spots the random, computer-generated web
  addresses fresh phishing sites tend to use.
- **AiTM (adversary in the middle).** A sign-in, code, or passkey prompt on a site whose
  address does not match the brand it appears to be, with guardrails so real identity
  providers and company proxies do not set it off.
- **Opt-in Safe Browsing.** If you add your own free Google Safe Browsing key, we check
  links against Google's list. Off by default.
- **Scam packs.** Targeted checks for specific scam patterns: a device-code sign-in scam,
  a page asking you to type your wallet recovery phrase or private key, and fake
  tech-support pages that try to scare you into calling a number.

## How we measure false positives

A false positive is a warning on a site that is actually fine. The warnings that matter
most are the loud ones, "high" and "critical", because those are the levels that alarm
you. So that is what we measure.

**The method, in plain terms:**

1. We take a large list of known-legitimate domains: the Majestic Million, a public
   ranking of the most-linked websites. These are real, popular, legitimate sites.
2. We run the passive part of the engine (the checks that look only at the web address,
   the part that runs on every site) on each one, with no page content involved.
3. We count how many of these known-good sites reach "high" or "critical".
4. That count, divided by the number of sites tested, is our false-positive rate.

The audit script also prints every domain it flagged, so the number is not something you
have to take on faith. You can see exactly which sites, and why.

**Reproduce it yourself:**

```sh
node scripts/fp-audit.mjs
```

That command loads the same engine data the shipped extension uses, tests the top
domains, and prints the totals and the full list of any domains it flagged. Run
`node scripts/fp-audit.mjs --selftest` first to confirm the harness is sound on a handful
of famous sites before trusting a big run. Use `--limit N` to test a different number of
domains, or `--cache <path>` to point at your own copy of the list.

**Our latest result:**

As of 2026-08-11, across 100,000 known-legitimate domains (the top of the Majestic Million):

| Measure | Value |
| --- | --- |
| Warnings at "high" | 5 |
| Warnings at "critical" | 0 |
| False-positive rate | 0.005% (5 in 100,000) |

The five were all very short, digit-heavy names on high-abuse endings (for example
`hy315.cc`), the kind of address that genuinely looks generated. You can see the full
list any time by running the command above.

We publish this so you can hold the number to account and reproduce it any time.

## Our test suite

FishCatcher ships with a test suite (83 checks) that runs on every change. It
covers the manifests, the locales, and the detection engine itself, including a corpus of
phishing addresses that must be caught and a corpus of legitimate addresses that must stay
quiet. If a change would make the engine noisier or weaker, the suite is meant to catch it
before the change ships.

```sh
node scripts/build.mjs      # build the extension
node tests/verify.mjs       # run the test suite
```

## Report a mistake

If FishCatcher warns about a site that is fine, or misses a site that is not, please tell
us. Open an issue on the threat registry tracker:
[fishcatcher-registry issues](https://github.com/Topurrra/fishcatcher-registry/issues).
Real examples make the lists and the model better for everyone.
