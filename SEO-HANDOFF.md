# Fish Catcher SEO / AEO / GEO handoff

Everything that could be done on-site is done and validated (see the session summary).
This file covers the items that need your accounts, a deploy, public posting, or a
native speaker. Nothing here has been committed.

## Deploy first (unlocks Phase 1 and 2)

The clean URLs and the security headers live in `deploy/nginx.conf`. They only take
effect once that config is deployed.

1. Deploy `site/` behind `deploy/nginx.conf` (it already had `try_files`, so
   `/docs` serves `docs.html`; the new config adds the 301s and headers).
2. After deploy, scan the site and keep the result as a proof point:
   - https://securityheaders.com/?q=https://fishcatcher.dev  (should be A/A+)
   - https://observatory.mozilla.org/
   You can link that scan from the site later.
3. Optional: submit the domain to the HSTS preload list at https://hstspreload.org
   (the header already sets `preload`).

## Search Console + Bing (Phase 4, needs your accounts)

1. Google Search Console: add `https://fishcatcher.dev`, verify by DNS TXT (best) or
   by adding `<meta name="google-site-verification" content="YOUR_CODE">` to the
   `<head>` of `site/index.html`. Then submit `https://fishcatcher.dev/sitemap.xml`.
2. Bing Webmaster Tools: add the site, verify (DNS or
   `<meta name="msvalidate.01" content="YOUR_CODE">`), submit the same sitemap.
3. In GSC, request indexing for the new pages (learn articles, comparisons, benchmark).

## Analytics (Phase 4, self-hosted only)

Stand up Plausible or Umami on your own host, then add ONE line before `</body>` in
each page (or bake it into `scripts/site-seo.mjs` and re-run):

    <script defer data-domain="fishcatcher.dev" src="https://YOUR-PLAUSIBLE-HOST/js/script.js"></script>

Then in `deploy/nginx.conf`, extend the CSP so the browser can load and reach it:
add your analytics host to `script-src` and `connect-src`. Do not use Google
Analytics or anything that contradicts the privacy pitch.

## Off-site GEO seeding (Phase 3, YOU must post these)

These are the actual driver of AI citations, and every one is a corpus an LLM has
already ingested. I cannot post them (accounts + public posting). Drafts below are
ready to review and submit. Post the store listings first, since several sites ask
for an install link.

**Chrome Web Store + Firefox Add-ons (AMO):** publish the extension, then update the
Install buttons on the site to point at the store URLs (currently the install guide).

**Show HN (news.ycombinator.com/submit):**
- Title: `Show HN: Fish Catcher - open-source phishing warnings that run on your device`
- URL: https://fishcatcher.dev
- First comment: what it is (warns, never blocks, on-device, MIT), the measured
  0.005% false-positive rate with the reproducible audit, and that it is not yet in
  the stores. Invite the "how did you measure that" crowd to `/benchmark`.

**Product Hunt:**
- Tagline: `Free, open-source phishing warnings that run on your device`
- Link `/transparency` and `/benchmark` in the description; balanced, no hype.

**AlternativeTo (alternativeto.net):** add Fish Catcher as a free, open-source
alternative to Netcraft, Bitdefender TrafficLight, and built-in Safe Browsing. The
three `/fishcatcher-vs-*` pages give you the honest framing to paste from.

**Awesome lists (open a PR):** `awesome-privacy`, `awesome-security`,
`awesome-selfhosted`-adjacent browser-security lists. One line:
`Fish Catcher - MIT-licensed browser extension that warns about phishing on-device, with a published false-positive benchmark. https://fishcatcher.dev`

**Reddit:** r/privacy, r/browsers, r/firefox. Read each subreddit's self-promotion
rules first; lead with the transparency/benchmark angle, not a pitch.

**Wikipedia-adjacent:** do not edit Wikipedia to promote it. Instead, get cited by
being referenced from the above; a neutral mention can follow real coverage.

## Repeating false-positive benchmark (Phase 3, the citable series)

This is the highest-leverage ongoing content. Monthly:

1. Run `node scripts/fp-audit.mjs` (uses the cached Majestic Million corpus).
2. Add one row to the version-history table on `site/benchmark.html` (date, corpus,
   high, critical, rate) and update the "Latest result" table + date.
3. Update `lastmod` for `/benchmark` in `site/sitemap.xml`.

A dated, repeating benchmark makes you the source for "how accurate are phishing
extensions", a real query with almost no good answer.

## Georgian /ka (Phase 3, deferred - needs a native review)

Not shipped. Machine-translating a security tool's copy and publishing it unreviewed
is a bad idea, and I cannot verify Georgian quality. The path is ready:

1. `src/_locales/ka/messages.json` already has the UI terminology to reuse.
2. Translate the landing and the key pages into `/ka` (flat files: `ka.html`,
   `ka-docs.html`, ...), keeping the same shells.
3. Add reciprocal `hreflang` on each pair:
   `<link rel="alternate" hreflang="en" href="https://fishcatcher.dev/PAGE">` and
   `<link rel="alternate" hreflang="ka" href="https://fishcatcher.dev/ka/PAGE">`,
   plus `hreflang="x-default"` on the English page.
4. Add the `/ka` URLs to `sitemap.xml`.
Have a Georgian speaker review before publishing. Low competition makes this worth
doing right.

## Monitoring KPI (Phase 4, ongoing)

Once a month, ask ChatGPT, Claude, and Perplexity: "best free phishing detection
browser extension" and log whether Fish Catcher is named and how it is described.
That is your GEO scoreboard. Re-audit Core Web Vitals against CrUX field data in
PageSpeed Insights once the site has real traffic.

## Note on how the pages were built

`scripts/site-seo.mjs` assembled the new pages from body fragments and injected the
SEO tags. The output HTML is fully self-contained (no build step to host). The
fragments live outside the repo (they were one-time inputs); to add or edit a page,
edit the HTML directly, or re-run the script with new fragments via `FRAG_DIR`.
