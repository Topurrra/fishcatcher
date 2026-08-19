// Builds src/data/psl.json from the full Public Suffix List (ICANN + PRIVATE).
// Rules are kept in PSL syntax: plain "co.uk", wildcard "*.ck", exception "!www.ck".
// Unicode labels are stored punycode-encoded so they match URL.hostname as-is.
//
// Cache (dev-only, gitignored): scripts/data/public_suffix_list.dat
// Run: node scripts/build-psl.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://publicsuffix.org/list/public_suffix_list.dat';
const cache = join(root, 'scripts/data/public_suffix_list.dat');

let text;
if (existsSync(cache)) {
  text = readFileSync(cache, 'utf8');
} else {
  console.log('cache miss: downloading the Public Suffix List (cached afterwards)...');
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  text = await res.text();
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, text);
}

// URL does the IDNA toASCII for us; rules it rejects cannot appear in a hostname anyway.
const toAscii = (label) => {
  try {
    return new URL('http://' + label).hostname;
  } catch {
    return null;
  }
};

// Multi-tenant hosts the PSL does not list but where phishing pages live; each
// tenant must stay its own registrable domain (brand-in-tenant-name detection).
const EXTRA = [
  'weebly.com', 'wordpress.com', 'glitch.me', 'surge.sh', 'amazonaws.com', 'storage.googleapis.com',
  'ipfs.io', '000webhostapp.com', 'godaddysites.com', 'mystrikingly.com', 'loca.lt', 'serveo.net',
  'blogspot.co.uk', 'blogspot.de', 'blogspot.fr', 'blogspot.in', 'blogspot.com.br'
];

const suffixes = [];
let skipped = 0;
for (const raw of text.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('//')) continue;
  let prefix = '';
  let rule = line;
  if (rule.startsWith('*.')) { prefix = '*.'; rule = rule.slice(2); }
  else if (rule.startsWith('!')) { prefix = '!'; rule = rule.slice(1); }
  const ascii = toAscii(rule);
  if (!ascii) { skipped++; continue; }
  suffixes.push(prefix + ascii);
}
for (const e of EXTRA) if (!suffixes.includes(e)) suffixes.push(e);

const out = { version: 2, source: 'publicsuffix.org', fetched: statSync(cache).mtime.toISOString().slice(0, 10), suffixes };
const json = JSON.stringify(out);
writeFileSync(join(root, 'src/data/psl.json'), json + '\n');
console.log(`psl: ${suffixes.length} rules (${skipped} skipped), ${Math.round(json.length / 1024)} KB`);
