// Reproducible RECALL audit for FishCatcher's PASSIVE URL engine.
//
// The false-positive audit (fp-audit.mjs) proves the engine is quiet on good sites.
// This one asks the other question: of the phishing hosts that are live right now,
// how many does the engine rate as suspicious from the ADDRESS ALONE, before the
// site is on any list? It runs the exact shipped analyzer (analyzeUrl with NO page
// content opts) with the blocklist and the community Bloom feed switched OFF, so the
// number measures the heuristics + the on-device model, not the list. The list
// catches what these miss; that is its job and it is measured elsewhere.
//
// Corpus: the three public feeds the threat registry packs every day, fetched with
// the same parsers (Phishing.Database active domains, URLhaus hostfile, OpenPhish).
// Hostnames are deduplicated and cached per day under scripts/data/ so reruns are
// offline. Feeds change daily, so the cache file name carries the date.
//
// Run:
//   node scripts/recall-audit.mjs                 # all hosts from today's feeds
//   node scripts/recall-audit.mjs --limit 5000    # quick sample
//   node scripts/recall-audit.mjs --selftest      # prove the harness offline
//   node scripts/recall-audit.mjs --cache path.txt
//
// This is a MEASUREMENT tool, not a test: the measurement run always exits 0.
// The one exception is --selftest, which asserts and exits non-zero if the harness
// itself is broken.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeUrl } from '../src/engine/analyzer.js';
import { Bloom } from '../src/engine/bloom.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// Same data object as fp-audit.mjs / tests/verify.mjs, EXCEPT the two list signals
// are off: bloom = null and blockList = empty. A host that is on a list would score
// 45 or 60 from the list alone, which is exactly what this audit must not count.
const data = {
  safeList: new Set(readJson('src/data/safe-list.json').domains),
  brands: readJson('src/data/brands.json').brands,
  tlds: readJson('src/data/tlds.json').tlds,
  keywords: readJson('src/data/keywords.json').keywords,
  psl: readJson('src/data/psl.json').suffixes,
  blockList: new Set(),
  bloom: null,
  ml: readJson('src/data/ml-weights.json'),
  safeBloom: Bloom.fromPayload(readJson('src/data/safe-bloom.json')),
  aitmIdp: new Set(readJson('src/data/aitm-allow.json').idp),
  aitmMediation: new Set(readJson('src/data/aitm-allow.json').mediation)
};

// ── args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagVal = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const limit = Number(flagVal('--limit', String(Infinity)));
const today = new Date().toISOString().slice(0, 10);
const cachePath = flagVal('--cache', join(root, 'scripts', 'data', `phish-hosts-${today}.txt`));

// The three feeds the registry packs (registry/build-feed.mjs), same URLs, same parsers.
const SOURCES = [
  { name: 'Phishing.Database', url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt', parse: parseDomains },
  { name: 'URLhaus', url: 'https://urlhaus.abuse.ch/downloads/hostfile/', parse: parseHostfile },
  { name: 'OpenPhish', url: 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt', parse: parseUrls }
];
function parseDomains(text) {
  return text.split('\n').map((s) => s.trim().toLowerCase()).filter((d) => d && !d.startsWith('#') && d.includes('.'));
}
function parseHostfile(text) {
  // "0.0.0.0 host" / "127.0.0.1<tab>host" lines; take the trailing host.
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const host = t.split(/\s+/).pop().toLowerCase();
    if (host && host.includes('.') && host !== 'localhost') out.push(host);
  }
  return out;
}
function parseUrls(text) {
  // full URLs -> hostname.
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      const h = new URL(t).hostname.toLowerCase().replace(/\.$/, '');
      if (h && h.includes('.')) out.push(h);
    } catch { /* skip malformed line */ }
  }
  return out;
}

const LEVELS = ['low', 'elevated', 'high', 'critical'];
const fmtPct = (p) => `${p.toFixed(2)}%`;

// ── --selftest: prove the harness before trusting a big run ──────
// Obvious phishing shapes MUST score elevated or higher with the lists off, and a
// few famous sites must stay low. If not, the harness is mis-wired.
if (args.includes('--selftest')) {
  const phish = [
    'paypal-login-verify.com', 'secure-appleid.support', 'login-microsoft-365.weebly.com',
    'amazon-account-update.xyz', 'netflix-billing-confirm.top', 'chase-online-secure.info',
    'signin-coinbase-wallet.com', 'facebook-security-alert.cf', 'dhl-parcel-tracking-fee.live',
    'wellsfargo-verify-account.net', 'instagram-copyright-appeal.ml', 'metamask-wallet-restore.app'
  ];
  const legit = ['github.com', 'wikipedia.org', 'bbc.co.uk'];
  let bad = 0;
  for (const d of phish) {
    const r = analyzeUrl(`https://${d}/`, data);
    const ok = r && r.level !== 'low';
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${d} -> ${r ? `${r.level} (score ${r.score})` : 'null'}`);
    if (!ok) bad++;
  }
  for (const d of legit) {
    const r = analyzeUrl(`https://${d}/`, data);
    const ok = r && r.level === 'low';
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${d} -> ${r ? `${r.level} (score ${r.score})` : 'null'}`);
    if (!ok) bad++;
  }
  console.log(`\nselftest: ${phish.length + legit.length - bad}/${phish.length + legit.length} as expected`);
  assert.equal(bad, 0, 'selftest mismatch: harness or engine data is broken');
  process.exit(0);
}

// ── load the phishing corpus ─────────────────────────────────────
let hosts;
if (existsSync(cachePath)) {
  hosts = readFileSync(cachePath, 'utf8').split('\n').filter(Boolean);
} else {
  console.log('cache miss: downloading the three feeds (cached afterwards)...');
  const set = new Set();
  let loaded = 0;
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = src.parse(await res.text());
      for (const h of list) set.add(h);
      console.log(`  ${src.name}: ${list.length}`);
      loaded++;
    } catch (e) {
      console.error(`  ${src.name}: FAILED (${e.message})`);
    }
  }
  if (!loaded) {
    console.error('could not load any feed. Provide a host list with --cache <path>.');
    process.exit(0); // measurement tool: never hard-fail
  }
  hosts = [...set];
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, hosts.join('\n') + '\n');
}
if (hosts.length > limit) hosts = hosts.slice(0, limit);

// ── run the passive engine (NO opts, NO lists) over every host ───
const counts = { low: 0, elevated: 0, high: 0, critical: 0 };
const reasonFreq = new Map();
const missed = [];
let tested = 0;
for (const h of hosts) {
  const r = analyzeUrl(`https://${h}/`, data);
  if (!r) continue; // unparseable host: not part of the measurement
  tested++;
  counts[r.level]++;
  if (r.level === 'low') { missed.push(h); continue; }
  for (const x of r.reasons) reasonFreq.set(x.key, (reasonFreq.get(x.key) || 0) + 1);
}

// ── report ───────────────────────────────────────────────────────
const pct = (n) => (tested ? (n / tested) * 100 : 0);
const alarm = counts.high + counts.critical;
const any = alarm + counts.elevated;

console.log('FishCatcher recall audit (passive URL engine, lists OFF)');
console.log(`date:     ${today}`);
console.log(`corpus:   ${cachePath}`);
console.log(`tested:   ${tested} phishing hosts`);
for (const l of LEVELS) console.log(`${(l + ':').padEnd(10)}${String(counts[l]).padStart(7)}  ${fmtPct(pct(counts[l]))}`);
console.log(`alarm recall (high+critical):          ${alarm}  ${fmtPct(pct(alarm))}`);
console.log(`any-signal recall (elevated or above): ${any}  ${fmtPct(pct(any))}`);
console.log('');
console.log('top reasons among flagged hosts:');
for (const [k, n] of [...reasonFreq].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${k.padEnd(28)} ${n}`);
}
console.log('');
// Feeds are roughly sorted, so take 20 evenly spaced misses rather than the first 20.
console.log('sample missed hosts (low), evenly spaced through the corpus:');
const step = Math.max(1, Math.floor(missed.length / 20));
for (let i = 0; i < missed.length && i < step * 20; i += step) console.log(`  ${missed[i]}`);

process.exit(0); // always 0: a measurement, not a pass/fail test
