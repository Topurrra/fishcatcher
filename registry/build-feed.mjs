// Builds fishcatcher-lists.json: fetches several free, redistributable
// malicious-domain feeds and packs the hostnames into a Bloom filter the
// FishCatcher extension reads at runtime. No API keys; nothing about the user
// is involved, and lookups happen locally in the extension.
//
// Sources (all keyless and redistributable):
//   - Phishing.Database (mitchellkrogza mirror) — active phishing domains
//   - URLhaus (abuse.ch)                          — malware host file
//   - OpenPhish community feed                    — phishing URLs
//   - community-reports.txt (optional, local)     — maintainer-confirmed reports
//
// The Bloom implementation MUST stay byte-compatible with src/engine/bloom.js
// in the extension repo, or lookups will miss. No dependencies. Node 22+.
// Run: node build-feed.mjs        (add --force to override the drop guard)
//      node build-feed.mjs --selftest   (offline check of the pure logic)
import { writeFileSync, readFileSync } from 'node:fs';

const TARGET_FPR = 0.003; // 0.3% false positives; the extension only warns, never blocks
const OUT = 'fishcatcher-lists.json';
const COMMUNITY_FILE = 'community-reports.txt'; // written by the workflow from confirmed-phish issues
const FETCH_TIMEOUT_MS = 20000;                 // a single slow feed must not hang the build
const FETCH_TRIES = 3;
const MIN_HOSTS = 1000;                          // hard floor: below this the merge looks broken
const DROP_RATIO = 0.6;                          // refuse a rebuild under 60% of the last good count

const SOURCES = [
  { name: 'Phishing.Database', url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt', parse: parseDomains },
  { name: 'URLhaus', url: 'https://urlhaus.abuse.ch/downloads/hostfile/', parse: parseHostfile },
  { name: 'OpenPhish', url: 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt', parse: parseUrls }
];

// ── parsers → hostnames ─────────────────────────────────────────
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
  // full URLs → hostname.
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

// True when a rebuild dropped so far below the last good count that it looks
// broken (a partial fetch, a mangled feed) rather than a real change.
function feedDropTooFar(n, prevCount, force) {
  return prevCount > 0 && !force && n < prevCount * DROP_RATIO;
}

// ── Bloom (mirror of src/engine/bloom.js) ───────────────────────
function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
class Bloom {
  constructor(m, k, seed = 1) {
    this.m = m; this.k = k; this.seed = seed;
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }
  _hashes(s) {
    return [fnv1a(s, 0x811c9dc5 ^ this.seed), fnv1a(s, 0x01000193 + this.seed)];
  }
  add(s) {
    const [h1, h2] = this._hashes(s);
    for (let i = 0; i < this.k; i++) {
      // >>> 0 keeps the index unsigned (matches src/engine/bloom.js).
      const bit = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      this.bits[bit >> 3] |= 1 << (bit & 7);
    }
  }
  toBase64() {
    return Buffer.from(this.bits).toString('base64');
  }
}

// ── offline self-check (no network): node build-feed.mjs --selftest ─
function runSelfTest() {
  const assert = (c, m) => { if (!c) throw new Error('selftest FAILED: ' + m); };
  assert(parseDomains('#c\nEvil.COM\nnotadomain\n a.b \n').join(',') === 'evil.com,a.b', 'parseDomains tolerance');
  assert(feedDropTooFar(500, 1000, false) === true, 'drop below 60% is blocked');
  assert(feedDropTooFar(700, 1000, false) === false, 'drop above 60% is allowed');
  assert(feedDropTooFar(1, 1000, true) === false, 'force overrides the guard');
  assert(feedDropTooFar(500, 0, false) === false, 'no previous list => allow');
  console.log('selftest ok');
}
if (process.argv.includes('--selftest')) { runSelfTest(); process.exit(0); }

// Fetch with a per-attempt timeout and a couple of retries, so one slow or
// flaky feed cannot hang the whole build. Throws only after all tries fail;
// the caller still catches that so a single dead feed does not sink the build.
async function fetchText(url) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_TRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_TRIES) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

// ── fetch + merge (one feed failing must not sink the whole build) ─
const force = process.env.FORCE_REBUILD === '1' || process.argv.includes('--force');
const domains = new Set();
const stats = [];
const usedSources = [];
for (const src of SOURCES) {
  try {
    const hosts = src.parse(await fetchText(src.url));
    for (const h of hosts) domains.add(h);
    stats.push(`${src.name}: ${hosts.length}`);
    usedSources.push(src.name);
  } catch (e) {
    stats.push(`${src.name}: FAILED (${e.message})`);
    console.error(`WARN ${src.name} feed failed: ${e.message}`);
  }
}

// Local, human-reviewed reports. The workflow writes COMMUNITY_FILE from issues
// a maintainer labeled 'confirmed-phish'. No file / empty file => nothing added,
// so the build proceeds unchanged.
try {
  const hosts = parseDomains(readFileSync(COMMUNITY_FILE, 'utf8'));
  for (const h of hosts) domains.add(h);
  if (hosts.length) { stats.push(`community-reports: ${hosts.length}`); usedSources.push('community-reports'); }
} catch { /* no community file this run */ }

const n = domains.size;
if (n < MIN_HOSTS) throw new Error(`merged feed looks truncated: only ${n} hosts — refusing to overwrite`);

// Safety valve: never let a bad/partial rebuild clobber a good published list.
let prevCount = 0;
try { prevCount = JSON.parse(readFileSync(OUT, 'utf8')).count || 0; } catch { /* no previous list */ }
if (feedDropTooFar(n, prevCount, force)) {
  throw new Error(
    `merged feed dropped to ${n} hosts from ${prevCount} (under ${Math.round(DROP_RATIO * 100)}%). ` +
    `Refusing to overwrite the last good list. Re-run with --force (or FORCE_REBUILD=1) if this drop is real.`
  );
}

const m = Math.ceil((-n * Math.log(TARGET_FPR)) / (Math.LN2 * Math.LN2));
const k = Math.max(1, Math.round((m / n) * Math.LN2));
const bloom = new Bloom(m, k, 1);
for (const d of domains) bloom.add(d);

const bundle = {
  version: 2,
  generated: new Date().toISOString(),
  sources: usedSources,
  count: n,
  bloom: { m, k, seed: 1, bits: bloom.toBase64() }
};
writeFileSync(OUT, JSON.stringify(bundle));

// Read the file back and re-parse it, so a truncated or corrupt write fails the
// build here instead of shipping a broken list to the extension.
JSON.parse(readFileSync(OUT, 'utf8'));

console.log(`packed ${n} hosts -> ${OUT} (m=${m}, k=${k}, ~${Math.round(m / 8 / 1024)}KB filter)\n  ${stats.join('\n  ')}`);
