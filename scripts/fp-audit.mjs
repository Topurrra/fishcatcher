// Reproducible false-positive audit for FishCatcher's PASSIVE URL engine.
//
// It runs the exact shipped analyzer (analyzeUrl with NO page-content opts) over a
// large corpus of known-legitimate domains and counts how many the engine would
// warn about at 'high' or 'critical' — the two levels that actually alarm a user.
// The offending domains are listed so the number is auditable ("show the data").
//
// Corpus: the Majestic Million top-domains list — the SAME source and cache path
// scripts/train-ml.mjs uses, so this runs offline once the CSV is cached.
//
// Run:
//   node scripts/fp-audit.mjs                 # default: first 100000 domains
//   node scripts/fp-audit.mjs --limit 2000    # quick sample
//   node scripts/fp-audit.mjs --selftest      # prove the harness on ~10 famous domains
//   node scripts/fp-audit.mjs --cache path.csv
//
// This is a MEASUREMENT tool, not a test: the measurement run always exits 0 so a
// non-zero false-positive finding never breaks a pipeline. The one exception is
// --selftest, which asserts and exits non-zero if the harness itself is broken.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeUrl } from '../src/engine/analyzer.js';
import { Bloom } from '../src/engine/bloom.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// Build the SAME data object tests/verify.mjs uses, so the audit reflects the
// shipped engine — including the safe-list and the safe-bloom allowlist that
// suppress brand false positives. (No `bloom` community feed and no `trustList`,
// exactly as verify.mjs constructs it: this measures the bundled default engine.)
const data = {
  safeList: new Set(readJson('src/data/safe-list.json').domains),
  brands: readJson('src/data/brands.json').brands,
  tlds: readJson('src/data/tlds.json').tlds,
  keywords: readJson('src/data/keywords.json').keywords,
  psl: readJson('src/data/psl.json').suffixes,
  blockList: new Set(readJson('src/data/blocklist.json').domains),
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
const limit = Number(flagVal('--limit', '100000'));
// Same cache path as train-ml.mjs so a single download serves both.
const csvPath = flagVal('--cache', join(root, 'scripts', 'data', 'majestic_million.csv'));
const MAJESTIC_URL = 'https://downloads.majestic.com/majestic_million.csv';

// A domain "alarms the user" only at high/critical (>=45). Elevated/low do not.
const alarms = (level) => level === 'high' || level === 'critical';

// Format a small percentage with enough precision to read (e.g. 0.005%), no noise.
const fmtPct = (p) => `${p.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}%`;

// ── --selftest: prove the harness before trusting a big run ──────
// ~10 famous domains that MUST stay calm. If any of these flags high/critical the
// engine data is broken (or mis-wired here) and a full run would be meaningless.
if (args.includes('--selftest')) {
  const famous = [
    'google.com', 'github.com', 'bbc.co.uk', 'wikipedia.org', 'microsoft.com',
    'apple.com', 'amazon.com', 'cloudflare.com', 'mozilla.org', 'tbcbank.ge'
  ];
  let bad = 0;
  for (const d of famous) {
    const r = analyzeUrl(`https://${d}/`, data);
    const ok = r && !alarms(r.level);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${d} → ${r ? `${r.level} (score ${r.score})` : 'null'}`);
    if (!ok) bad++;
  }
  console.log(`\nselftest: ${famous.length - bad}/${famous.length} famous domains stayed calm`);
  // The one mode that exits non-zero: a broken harness must fail loudly.
  assert.equal(bad, 0, 'a famous domain was flagged: harness or engine data is broken');
  process.exit(0);
}

// ── load the legit corpus ────────────────────────────────────────
let text;
if (existsSync(csvPath)) {
  text = readFileSync(csvPath, 'utf8');
} else {
  // Only fetch when the cache is missing; then cache it so reruns are offline.
  console.log('cache miss: downloading Majestic Million (cached afterwards)...');
  try {
    const res = await fetch(MAJESTIC_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    mkdirSync(dirname(csvPath), { recursive: true });
    writeFileSync(csvPath, text);
  } catch (e) {
    console.error(`could not load corpus (${e.message}). Provide a CSV with --cache <path>.`);
    process.exit(0); // measurement tool: never hard-fail
  }
}

// Majestic CSV columns: GlobalRank,TldRank,Domain,... → the domain is index 2.
// Same column train-ml.mjs reads. Skip the header line (index 0).
const domains = [];
const lines = text.split('\n');
for (let i = 1; i < lines.length && domains.length < limit; i++) {
  const domain = lines[i].split(',')[2]?.trim().toLowerCase();
  if (domain) domains.push(domain);
}

// ── run the passive engine (NO opts) over every domain ───────────
const offenders = [];
let high = 0, critical = 0, tested = 0;
for (const d of domains) {
  const r = analyzeUrl(`https://${d}/`, data); // no opts → passive URL engine only
  if (!r) continue; // unparseable host: not part of the measurement
  tested++;
  if (r.level === 'high') high++;
  else if (r.level === 'critical') critical++;
  else continue;
  offenders.push({ domain: d, score: r.score, level: r.level, reasons: r.reasons.map((x) => x.key) });
}

// ── report ───────────────────────────────────────────────────────
offenders.sort((a, b) => b.score - a.score);
const flagged = high + critical;
const pct = tested ? (flagged / tested) * 100 : 0;

console.log('FishCatcher false-positive audit (passive URL engine)');
console.log(`date:     ${new Date().toISOString().slice(0, 10)}`);
console.log(`corpus:   Majestic Million (${csvPath})`);
console.log(`tested:   ${tested} known-legit domains`);
console.log(`high:     ${high}`);
console.log(`critical: ${critical}`);
console.log(`false positives (high+critical): ${flagged}`);
console.log(`false-positive rate: ${fmtPct(pct)}  (${flagged} in ${tested})`);
console.log('');
if (offenders.length) {
  console.log('offending domains (score, level, reasons):');
  for (const o of offenders) {
    console.log(`  ${o.domain}  ${o.score}  ${o.level}  [${o.reasons.join(', ')}]`);
  }
} else {
  console.log('no domains reached high or critical.');
}

process.exit(0); // always 0 — a measurement, not a pass/fail test
