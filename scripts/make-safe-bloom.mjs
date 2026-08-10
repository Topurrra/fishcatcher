// Builds src/data/safe-bloom.json: a Bloom filter of the top-N legitimate
// registrable domains (Majestic Million). The engine uses it to suppress
// brand-impersonation signals for well-known sites, killing false positives
// like google.ca, github.io, goo.gl, redhat.com.
//
// Input (dev-only, gitignored): scripts/data/majestic_million.csv
// Run: node scripts/make-safe-bloom.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bloom } from '../src/engine/bloom.js';
import { registrableDomain } from '../src/engine/psl.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = 100000;
const TARGET_FPR = 0.001; // low, so few unknown-bad domains slip past brand checks

const psl = JSON.parse(readFileSync(join(root, 'src/data/psl.json'), 'utf8')).suffixes;
const lines = readFileSync(join(root, 'scripts/data/majestic_million.csv'), 'utf8').split('\n').slice(1, N + 1);

const regs = new Set();
for (const line of lines) {
  const host = line.split(',')[2];
  if (!host) continue;
  const reg = registrableDomain(host.toLowerCase().replace(/\.$/, ''), psl);
  if (reg && reg.includes('.')) regs.add(reg);
}

const n = regs.size;
const m = Math.ceil((-n * Math.log(TARGET_FPR)) / (Math.LN2 * Math.LN2));
const k = Math.max(1, Math.round((m / n) * Math.LN2));
const bloom = new Bloom(m, k, 1);
for (const r of regs) bloom.add(r);

writeFileSync(
  join(root, 'src/data/safe-bloom.json'),
  JSON.stringify({ version: 1, count: n, m, k, seed: 1, bits: bloom.toBase64() })
);
console.log(`safe-bloom: ${n} registrable domains from top ${N} (m=${m}, k=${k}, ~${Math.round(m / 8 / 1024)}KB)`);
