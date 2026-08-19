// Merges the per-country/per-sector brand packs in src/data/brands/*.json into
// the single shipped src/data/brands.json, with a false-positive gate.
//
// The packs are the SOURCE of truth; the merged file is what ships. Contributors
// add their banks to a pack (or a new pack) and run this script. The script:
//   1. validates every entry (keyword length, forbidden generic keywords,
//      lowercase registrable canonical domain, unique names),
//   2. re-runs the fp-audit measurement (same corpus and data wiring as
//      scripts/fp-audit.mjs) for the OLD list and the merged candidate,
//   3. prints, per keyword, which legit domains the candidate would flag, and
//   4. FAILS (exit 1, shipped brands.json untouched) if the candidate alarms
//      any top-100k legit domain (high+critical must stay 0) or grows
//      "elevated" by more than 30. Only when the gate passes is the merged
//      file written. A keyword that trips legit sites gets removed from its
//      pack, never silenced in engine code.
//
// Corpus layout: the HARD gate runs on the Majestic top 100k, the same corpus
// scripts/fp-audit.mjs reports on (the shipped 0-FP guarantee is defined there;
// the safe-bloom is built from those exact rows, so brand signals are
// suppressed on them by design). Rows 100k..GATE_LIMIT are an ADVISORY band:
// legit domains outside the bloom, where keywords actually get exercised. The
// advisory listing is what tells you which keyword to remove from its pack.
// ponytail: plain full re-runs, no caching; a few minutes is fine for a
// data-curation tool.
//
// Also prints an informational recall diff against the newest cached
// scripts/data/phish-hosts-*.txt (from recall-audit.mjs), if present.
//
// Run: node scripts/build-brands.mjs [--gate-limit 300000] [--recall-limit 100000]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeUrl } from '../src/engine/analyzer.js';
import { registrableDomain, sldOf } from '../src/engine/psl.js';
import { Bloom } from '../src/engine/bloom.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const args = process.argv.slice(2);
const flagVal = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const GATE_LIMIT = flagVal('--gate-limit', 300000);
const RECALL_LIMIT = flagVal('--recall-limit', 100000);
const ELEVATED_BUDGET = 30;

// Short keywords are allowed only for exact brand acronyms. Everything else
// must be 4+ chars so digit-folding (S3) and substring matching stay precise.
const ACRONYMS = new Set([
  'aws', 'bog', 'tbc', 'hsbc', 'dhl', 'ups', 'usps', 'klm', 'dpd', 'gls', 'tnt',
  'ctt', 'pnc', 'dnb', 'kbc', 'aib', 'bmo', 'dbs', 'uob', 'fnb', 'sfr', 'okx',
  'tsb', 'n26'
]);
// Dictionary-common substrings that appear in countless benign hosts. Never
// allowed as a keyword on their own.
const FORBIDDEN = new Set([
  'bank', 'mail', 'pay', 'coin', 'login', 'secure', 'account', 'verify',
  'update', 'online', 'crypto', 'wallet', 'post', 'shop', 'store', 'free',
  'sign', 'support', 'billing', 'invoice'
]);

const psl = readJson('src/data/psl.json').suffixes;
const packsDir = join(root, 'src', 'data', 'brands');
const packFiles = readdirSync(packsDir).filter((f) => f.endsWith('.json')).sort();
// Merge order: core first (most-impersonated global brands win first-match in
// S3), then everything else alphabetically.
packFiles.sort((a, b) => (a === 'core.json' ? -1 : b === 'core.json' ? 1 : a.localeCompare(b)));

const brands = [];
const names = new Set();
const errors = [];
const warnings = [];
for (const f of packFiles) {
  const pack = JSON.parse(readFileSync(join(packsDir, f), 'utf8'));
  for (const b of pack.brands) {
    const at = `${f}: ${b.name}`;
    if (!b.name || names.has(b.name)) errors.push(`${at}: missing or duplicate name`);
    names.add(b.name);
    if (!Array.isArray(b.domains) || !b.domains.length) errors.push(`${at}: no domains`);
    if (!Array.isArray(b.keywords) || !b.keywords.length) errors.push(`${at}: no keywords`);
    for (const d of b.domains ?? []) {
      if (d !== d.toLowerCase() || !/^[a-z0-9.-]+$/.test(d)) errors.push(`${at}: bad domain ${d}`);
    }
    const canon = b.domains?.[0];
    if (canon && registrableDomain(canon, psl) !== canon) {
      errors.push(`${at}: canonical domain ${canon} is not a registrable domain`);
    }
    for (const k of b.keywords ?? []) {
      if (k !== k.toLowerCase() || !/^[a-z0-9.-]+$/.test(k)) errors.push(`${at}: bad keyword ${k}`);
      if (FORBIDDEN.has(k)) errors.push(`${at}: keyword "${k}" is a forbidden generic word`);
      if (k.length < 4 && !ACRONYMS.has(k)) errors.push(`${at}: keyword "${k}" under 4 chars and not a listed acronym`);
    }
    brands.push(b);
  }
}
// A keyword that is a substring of ANOTHER brand's domain will fire on that
// brand's phish (naming the wrong brand) and possibly on its legit subdomains.
for (const b of brands) {
  for (const k of b.keywords) {
    for (const other of brands) {
      if (other === b) continue;
      if (other.domains.some((d) => d.includes(k))) {
        warnings.push(`keyword "${k}" (${b.name}) is a substring of ${other.name}'s domain`);
      }
    }
  }
}
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
for (const w of warnings) console.warn(`warn:  ${w}`);
console.log(`packs: ${packFiles.join(', ')}`);
console.log(`merged ${brands.length} brands from ${packFiles.length} packs`);

// ── engine data (same wiring as scripts/fp-audit.mjs) ────────────
const baseData = {
  safeList: new Set(readJson('src/data/safe-list.json').domains),
  tlds: readJson('src/data/tlds.json').tlds,
  keywords: readJson('src/data/keywords.json').keywords,
  psl,
  blockList: new Set(readJson('src/data/blocklist.json').domains),
  ml: readJson('src/data/ml-weights.json'),
  safeBloom: Bloom.fromPayload(readJson('src/data/safe-bloom.json')),
  aitmIdp: new Set(readJson('src/data/aitm-allow.json').idp),
  aitmMediation: new Set(readJson('src/data/aitm-allow.json').mediation)
};

const csvPath = join(root, 'scripts', 'data', 'majestic_million.csv');
if (!existsSync(csvPath)) {
  console.error(`no Majestic cache at ${csvPath}; run scripts/fp-audit.mjs once to download it.`);
  process.exit(1);
}
const legitDomains = [];
const lines = readFileSync(csvPath, 'utf8').split('\n');
for (let i = 1; i < lines.length && legitDomains.length < GATE_LIMIT; i++) {
  const d = lines[i].split(',')[2]?.trim().toLowerCase();
  if (d) legitDomains.push(d);
}

const GATE_ROWS = 100000;
const gateDomains = legitDomains.slice(0, GATE_ROWS);
const advisoryDomains = legitDomains.slice(GATE_ROWS);

const BRAND_KEYS = new Set(['reasonBrand', 'reasonBrandSubdomain']);
function fpRun(brandList, domains) {
  const data = { ...baseData, brands: brandList };
  const counts = { high: 0, critical: 0, elevated: 0 };
  const brandHits = []; // { domain, level, reasons }
  for (const d of domains) {
    const r = analyzeUrl(`https://${d}/`, data);
    if (!r) continue;
    if (counts[r.level] != null) counts[r.level]++;
    if (r.level !== 'low' && r.reasons.some((x) => BRAND_KEYS.has(x.key))) {
      brandHits.push({ domain: d, level: r.level, reasons: r.reasons.filter((x) => BRAND_KEYS.has(x.key)) });
    }
  }
  return { counts, brandHits };
}

// Attribute an S3 hit to the exact keyword, replicating signals.js S3.
const S3_FOLD = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a' };
function keywordFor(host, brandList) {
  const registrable = registrableDomain(host, psl);
  const owned = host.slice(0, host.length - (registrable.length - sldOf(registrable).length));
  const ownedFold = owned.replace(/[0134578@]/g, (c) => S3_FOLD[c]);
  for (const brand of brandList) {
    if (brand.domains.includes(registrable)) continue;
    const kw = brand.keywords.find((k) => owned.includes(k) || (k.length >= 4 && ownedFold.includes(k)));
    if (kw) return { brand: brand.name, keyword: kw };
  }
  return null;
}

const oldBrands = readJson('src/data/brands.json').brands;

// Per-keyword FP contribution, for hits the old list did not have.
function newHitsPerKeyword(before, after) {
  const beforeSet = new Set(before.brandHits.map((h) => h.domain));
  const perKeyword = new Map();
  for (const h of after.brandHits) {
    if (beforeSet.has(h.domain)) continue;
    for (const x of h.reasons) {
      const attr = x.key === 'reasonBrandSubdomain'
        ? keywordFor(h.domain, brands)
        : { brand: x.params?.[0] ?? '?', keyword: `(S1 typo of ${x.params?.[0]})` };
      const key = attr ? `${attr.keyword} [${attr.brand}] ${x.key}` : `? ${x.key}`;
      if (!perKeyword.has(key)) perKeyword.set(key, []);
      perKeyword.get(key).push(`${h.domain} (${h.level})`);
    }
  }
  return perKeyword;
}
function printPerKeyword(perKeyword) {
  for (const [k, doms] of [...perKeyword].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k}: ${doms.length}  e.g. ${doms.slice(0, 5).join(', ')}`);
  }
}

// ── HARD gate: top 100k (the corpus the shipped FP rate is defined on) ──
console.log(`\nfp gate: scanning top ${gateDomains.length} Majestic domains (old list, then new)...`);
const before = fpRun(oldBrands, gateDomains);
const after = fpRun(brands, gateDomains);
const report = (tag, r) =>
  console.log(`${tag}: high+critical ${r.counts.high + r.counts.critical}, elevated ${r.counts.elevated}, brand-reason hits ${r.brandHits.length}`);
report('old', before);
report('new', after);
const gateKeywords = newHitsPerKeyword(before, after);
if (gateKeywords.size) {
  console.log('\nGATE: new brand-reason hits on top-100k legit domains, per keyword:');
  printPerKeyword(gateKeywords);
}

const alarmsBefore = before.counts.high + before.counts.critical;
const alarmsAfter = after.counts.high + after.counts.critical;
const elevatedGrowth = after.counts.elevated - before.counts.elevated;
const failed = alarmsAfter > Math.max(alarmsBefore, 0) || alarmsAfter > 0 || elevatedGrowth > ELEVATED_BUDGET;
console.log(`\ngate: high+critical ${alarmsBefore} -> ${alarmsAfter} (must stay 0), elevated ${before.counts.elevated} -> ${after.counts.elevated} (budget +${ELEVATED_BUDGET})`);

// ── ADVISORY band: rows beyond the safe-bloom, where keywords really fire ──
if (advisoryDomains.length) {
  console.log(`\nadvisory band: rows ${GATE_ROWS + 1}..${GATE_ROWS + advisoryDomains.length} (outside the safe-bloom; not gating)...`);
  const beforeAdv = fpRun(oldBrands, advisoryDomains);
  const afterAdv = fpRun(brands, advisoryDomains);
  report('old', beforeAdv);
  report('new', afterAdv);
  const advKeywords = newHitsPerKeyword(beforeAdv, afterAdv);
  if (advKeywords.size) {
    console.log('\nadvisory: new brand-reason hits per keyword (remove noisy ones from their pack):');
    printPerKeyword(advKeywords);
  }
}

if (failed) {
  console.error('\nFP GATE FAILED. brands.json left unchanged. Remove the offending keywords from their packs and rerun.');
  process.exit(1);
}

// Gate passed: write the merged file.
const outPath = join(root, 'src', 'data', 'brands.json');
const body = brands.map((b) => '    ' + JSON.stringify(b)).join(',\n');
writeFileSync(outPath, `{\n  "version": 1,\n  "brands": [\n${body}\n  ]\n}\n`);
console.log(`\nwrote src/data/brands.json (${brands.length} brands)`);

// ── informational recall diff (newest cached phish-hosts file) ───
const phishFiles = readdirSync(join(root, 'scripts', 'data'))
  .filter((f) => /^phish-hosts-.*\.txt$/.test(f)).sort();
if (!phishFiles.length) {
  console.log('no cached phish-hosts file; skipping recall diff (run scripts/recall-audit.mjs once).');
  process.exit(0);
}
const phishPath = join(root, 'scripts', 'data', phishFiles[phishFiles.length - 1]);
let hosts = readFileSync(phishPath, 'utf8').split('\n').filter(Boolean);
if (hosts.length > RECALL_LIMIT) hosts = hosts.slice(0, RECALL_LIMIT);
const recallData = { ...baseData, blockList: new Set(), bloom: null };
function brandRecall(brandList) {
  const data = { ...recallData, brands: brandList };
  let n = 0;
  for (const h of hosts) {
    const r = analyzeUrl(`https://${h}/`, data);
    if (r && r.reasons.some((x) => BRAND_KEYS.has(x.key))) n++;
  }
  return n;
}
console.log(`\nrecall diff (${phishFiles[phishFiles.length - 1]}, first ${hosts.length} hosts, lists off):`);
const rb = brandRecall(oldBrands);
const ra = brandRecall(brands);
console.log(`phish hosts with a brand reason: ${rb} -> ${ra} (${ra - rb >= 0 ? '+' : ''}${ra - rb})`);
