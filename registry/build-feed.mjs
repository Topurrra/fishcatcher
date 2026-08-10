// Builds fishcatcher-lists.json: fetches the active phishing-domain feed and
// packs it into a Bloom filter the FishCatcher extension reads at runtime.
//
// The Bloom implementation below MUST stay byte-compatible with
// src/engine/bloom.js in the extension repo, or lookups will miss.
//
// No dependencies. Node 20+ (built-in fetch). Run: node build-feed.mjs
import { writeFileSync } from 'node:fs';

const FEED = 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt';
const TARGET_FPR = 0.003; // 0.3% false positives; extension only warns, never blocks
const OUT = 'fishcatcher-lists.json';

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

const res = await fetch(FEED);
if (!res.ok) throw new Error(`feed fetch failed: ${res.status}`);

const domains = [...new Set(
  (await res.text())
    .split('\n')
    .map((s) => s.trim().toLowerCase())
    .filter((d) => d && !d.startsWith('#') && d.includes('.'))
)];

const n = domains.length;
if (n < 1000) throw new Error(`feed looks truncated: only ${n} domains`); // guard against a bad fetch overwriting a good list

const m = Math.ceil((-n * Math.log(TARGET_FPR)) / (Math.LN2 * Math.LN2));
const k = Math.max(1, Math.round((m / n) * Math.LN2));
const bloom = new Bloom(m, k, 1);
for (const d of domains) bloom.add(d);

const bundle = {
  version: 2,
  generated: new Date().toISOString(),
  source: FEED,
  count: n,
  bloom: { m, k, seed: 1, bits: bloom.toBase64() }
};
writeFileSync(OUT, JSON.stringify(bundle));
console.log(`packed ${n} domains -> ${OUT} (m=${m}, k=${k}, ~${Math.round(m / 8 / 1024)}KB filter)`);
