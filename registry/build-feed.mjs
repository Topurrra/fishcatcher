// Builds fishcatcher-lists.json: fetches several free, redistributable
// malicious-domain feeds and packs the hostnames into a Bloom filter the
// FishCatcher extension reads at runtime. No API keys; nothing about the user
// is involved, and lookups happen locally in the extension.
//
// Sources (all keyless and redistributable):
//   - Phishing.Database (mitchellkrogza mirror) — active phishing domains
//   - URLhaus (abuse.ch)                          — malware host file
//   - OpenPhish community feed                    — phishing URLs
//
// The Bloom implementation MUST stay byte-compatible with src/engine/bloom.js
// in the extension repo, or lookups will miss. No dependencies. Node 20+.
// Run: node build-feed.mjs
import { writeFileSync } from 'node:fs';

const TARGET_FPR = 0.003; // 0.3% false positives; the extension only warns, never blocks
const OUT = 'fishcatcher-lists.json';

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

// ── fetch + merge (one feed failing must not sink the whole build) ─
const domains = new Set();
const stats = [];
for (const src of SOURCES) {
  try {
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const hosts = src.parse(await res.text());
    for (const h of hosts) domains.add(h);
    stats.push(`${src.name}: ${hosts.length}`);
  } catch (e) {
    stats.push(`${src.name}: FAILED (${e.message})`);
    console.error(`WARN ${src.name} feed failed: ${e.message}`);
  }
}

const n = domains.size;
if (n < 1000) throw new Error(`merged feed looks truncated: only ${n} hosts — refusing to overwrite`);

const m = Math.ceil((-n * Math.log(TARGET_FPR)) / (Math.LN2 * Math.LN2));
const k = Math.max(1, Math.round((m / n) * Math.LN2));
const bloom = new Bloom(m, k, 1);
for (const d of domains) bloom.add(d);

const bundle = {
  version: 2,
  generated: new Date().toISOString(),
  sources: SOURCES.map((s) => s.name),
  count: n,
  bloom: { m, k, seed: 1, bits: bloom.toBase64() }
};
writeFileSync(OUT, JSON.stringify(bundle));
console.log(`packed ${n} hosts -> ${OUT} (m=${m}, k=${k}, ~${Math.round(m / 8 / 1024)}KB filter)\n  ${stats.join('\n  ')}`);
