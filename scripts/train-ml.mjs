// Trains the on-device host model (S17) and writes src/data/ml-weights.json.
//
// Positives: hostnames from the three public phishing feeds the registry packs
// (Phishing.Database active domains, URLhaus hostfile, OpenPhish), fetched here
// and cached per day under scripts/data/phish-hosts-YYYY-MM-DD.txt.
// Negatives: the Majestic Million list (cached at scripts/data/majestic_million.csv,
// the same file scripts/fp-audit.mjs reads). Both classes use the full hostname
// minus a leading "www.".
//
// Model: hashed character 3/4/5-gram logistic regression (plus a few shape tokens),
// see src/engine/ml.js for the exact feature function shared with inference.
// Trained with Adagrad on the logistic loss, quantised to int8 with one scale.
// The threshold is picked on the 10% held-out split so the false-positive rate on
// Majestic negatives stays at or below MAX_FPR.
//
// Run:
//   node scripts/train-ml.mjs              # fetch (or use cache), train, evaluate, write weights
//   node scripts/train-ml.mjs --selftest   # offline: tiny synthetic set, writes nothing
//   node scripts/train-ml.mjs --epochs 6 --buckets 65536
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mlTokens, mlNormHost, mlPredict, mlTopFeatures } from '../src/engine/ml.js';
import { fnv1a } from '../src/engine/bloom.js';
import { isIpAddress } from '../src/engine/signals.js';
import { registrableDomain } from '../src/engine/psl.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'scripts', 'data');
const args = process.argv.slice(2);
const flagVal = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BUCKETS = Number(flagVal('--buckets', '65536'));
const EPOCHS = Number(flagVal('--epochs', '5'));
const LR = 0.08;          // Adagrad step
const L2 = 1e-6;          // weight decay per touched weight
const HOLDOUT = 0.1;      // per class, stratified, fixed seed
const SUB_AUG = 0.3;      // extra negatives: this share of training negatives, re-issued under a real Majestic subdomain prefix
const DGA_POS = 80000;    // synthetic random-looking positives so S17 keeps catching DGA names
const GENERIC_SHARE = 0.3; // of the re-issued negatives, this share uses a generic infrastructure label
const GENERIC_PREFIXES = ['mail', 'm', 'app', 'api', 'login', 'accounts', 'account', 'docs', 'shop', 'store', 'blog', 'support', 'help', 'my', 'portal', 'secure', 'static', 'cdn', 'images', 'news', 'web', 'dev', 'forum', 'wiki', 'status', 'id', 'auth', 'sso', 'webmail', 'en'];
const TOP_WEIGHT = 3;      // training copies of each top-100k Majestic negative
const TENANT_AUG = 80000;  // benign-tenant negatives under hosting suffixes (an innocent myapp.netlify.app must not fire on the suffix alone)
const MAX_FPR = 0.005;    // threshold gate: at most 0.5% of held-out Majestic hosts fire
const STRICT_FPR = 0.001; // second operating point reported for comparison
const SEED = 42;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_TRIES = 3;

const MAJESTIC_URL = 'https://downloads.majestic.com/majestic_million.csv';
const majesticPath = join(dataDir, 'majestic_million.csv');
// Same URLs and parsers as registry/build-feed.mjs and scripts/recall-audit.mjs.
const SOURCES = [
  { name: 'Phishing.Database', url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt', parse: parseDomains },
  { name: 'URLhaus', url: 'https://urlhaus.abuse.ch/downloads/hostfile/', parse: parseHostfile },
  { name: 'OpenPhish', url: 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt', parse: parseUrls }
];
function parseDomains(text) {
  return text.split('\n').map((s) => s.trim().toLowerCase()).filter((d) => d && !d.startsWith('#') && d.includes('.'));
}
function parseHostfile(text) {
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── data loading ─────────────────────────────────────────────────
async function loadMajestic() {
  let text;
  if (existsSync(majesticPath)) {
    text = readFileSync(majesticPath, 'utf8');
  } else {
    console.log('downloading Majestic Million (cached afterwards)...');
    text = await fetchText(MAJESTIC_URL);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(majesticPath, text);
  }
  const out = [];
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].split(',')[2]?.trim().toLowerCase();
    if (d) out.push(d);
  }
  return out; // rank order preserved (index 0 = rank 1)
}

async function loadPhishHosts() {
  mkdirSync(dataDir, { recursive: true });
  const cached = readdirSync(dataDir).filter((f) => /^phish-hosts-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort().pop();
  if (cached) {
    console.log(`phishing corpus: using cache ${cached}`);
    return readFileSync(join(dataDir, cached), 'utf8').split('\n').filter(Boolean);
  }
  console.log('downloading the three phishing feeds (cached afterwards)...');
  const set = new Set();
  let loaded = 0;
  for (const src of SOURCES) {
    try {
      const list = src.parse(await fetchText(src.url));
      for (const h of list) set.add(h);
      loaded++;
      console.log(`  ${src.name}: ${list.length} hosts`);
    } catch (e) {
      console.log(`  ${src.name}: FAILED (${e.message})`);
    }
  }
  if (!loaded) throw new Error('no phishing feed could be fetched');
  const hosts = [...set].sort();
  writeFileSync(join(dataDir, `phish-hosts-${new Date().toISOString().slice(0, 10)}.txt`), hosts.join('\n') + '\n');
  return hosts;
}

// ── synthetic DGA positives (the feeds hold few; S17 must still flag random names) ─
const VOWELS = 'aeiou', CONS = 'bcdfghjklmnpqrstvwxyz', ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DGA_TLDS = ['com', 'net', 'org', 'info', 'biz', 'ru', 'cc', 'xyz', 'top', 'pw', 'su'];
function dgaHost(rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const len = 7 + Math.floor(rnd() * 12);
  let s = '';
  const kind = rnd();
  for (let i = 0; i < len; i++) {
    if (kind < 0.3) s += pick(ALNUM);                                   // uniform alnum
    else if (kind < 0.55) s += pick(CONS + VOWELS);                     // uniform letters
    else if (kind < 0.8) s += i % 2 ? pick(VOWELS) : pick(CONS);        // consonant-vowel
    else s += rnd() < 0.3 ? pick('0123456789') : pick(CONS + VOWELS);   // letters with digits
  }
  return `${s}.${pick(DGA_TLDS)}`;
}

// Majestic lists mostly bare registrable domains while real browsing hits
// mail./docs./m. hosts, so label count alone would read as "phishing". The ~2% of
// Majestic rows that do carry a subdomain give a real prefix distribution; some
// training negatives are re-issued under one of those prefixes.
function harvestPrefixes(hosts, psl) {
  const counts = new Map();
  for (const h of hosts) {
    const r = registrableDomain(h, psl);
    if (r && r !== h && h.endsWith('.' + r)) {
      const p = h.slice(0, h.length - r.length - 1);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  // frequency-weighted pool: a prefix appears as often as it does in the list
  const pool = [];
  for (const [p, n] of counts) for (let i = 0; i < n; i++) pool.push(p);
  return pool;
}

// ── features: precomputed, deduplicated bucket ids per host ──────
// Flat id buffer + offsets, grown by doubling, so 1.4M hosts fit in ~200 MB.
function featurize(hosts, ml) {
  const Ids = ml.buckets <= 65536 ? Uint16Array : Uint32Array;
  let buf = new Ids(hosts.length * 48);
  const off = new Uint32Array(hosts.length + 1);
  let n = 0;
  const seen = new Set();
  for (let i = 0; i < hosts.length; i++) {
    seen.clear();
    for (const t of mlTokens(ml, hosts[i])) seen.add(fnv1a(t) % ml.buckets);
    if (n + seen.size > buf.length) {
      const bigger = new Ids(buf.length * 2);
      bigger.set(buf);
      buf = bigger;
    }
    for (const id of seen) buf[n++] = id;
    off[i + 1] = n;
  }
  return { ids: buf, off };
}

// ── training ─────────────────────────────────────────────────────
function train(feat, y, opts) {
  const { buckets, epochs, lr, l2, seed, log } = opts;
  const N = y.length;
  const w = new Float32Array(buckets);
  const g2 = new Float32Array(buckets);
  let b = 0, gb2 = 0;
  const order = Array.from({ length: N }, (_, i) => i);
  const rnd = mulberry32(seed);
  for (let e = 0; e < epochs; e++) {
    shuffle(order, rnd);
    let loss = 0;
    for (const i of order) {
      const s = feat.off[i], t = feat.off[i + 1];
      let z = b;
      for (let k = s; k < t; k++) z += w[feat.ids[k]];
      const p = 1 / (1 + Math.exp(-z));
      const yi = y[i];
      loss -= yi ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9);
      const g = p - yi;
      for (let k = s; k < t; k++) {
        const id = feat.ids[k];
        const gi = g + l2 * w[id];
        g2[id] += gi * gi;
        w[id] -= (lr * gi) / (Math.sqrt(g2[id]) + 1e-8);
      }
      gb2 += g * g;
      b -= (lr * g) / (Math.sqrt(gb2) + 1e-8);
    }
    if (log) console.log(`epoch ${e + 1}/${epochs}: mean loss ${(loss / N).toFixed(4)}`);
  }
  return { w, b };
}

// int8 with one scale; bias stays a float.
function quantise(w, b) {
  let max = 0;
  for (const v of w) max = Math.max(max, Math.abs(v));
  const scale = max / 127 || 1;
  const q = new Int8Array(w.length);
  for (let i = 0; i < w.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(w[i] / scale)));
  return { q, scale, bias: b };
}

function toWeightsFile(q, scale, bias, buckets, threshold, trained) {
  return {
    version: 2,
    ngrams: [3, 4, 5],
    buckets,
    scale: Number(scale.toPrecision(6)),
    bias: Number(bias.toFixed(4)),
    threshold,
    table: Buffer.from(q.buffer).toString('base64'),
    trained
  };
}

// ── evaluation helpers ───────────────────────────────────────────
const scoreAll = (ml, hosts) => hosts.map((h) => mlPredict(ml, h));
// Smallest threshold (3 decimals) at which at most `fpr` of the negatives fire.
function pickThreshold(negScores, fpr) {
  const sorted = [...negScores].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * (1 - fpr)) - 1);
  const t = Math.min(0.999, Math.ceil((sorted[idx] + 1e-9) * 1000) / 1000);
  // ceil may land exactly on a tie; step up until the rate is really met
  let th = t;
  while (th < 0.999 && sorted.filter((s) => s >= th).length / sorted.length > fpr) th = Math.round((th + 0.001) * 1000) / 1000;
  return th;
}
function prf(posScores, negScores, th) {
  const tp = posScores.filter((s) => s >= th).length;
  const fp = negScores.filter((s) => s >= th).length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = posScores.length ? tp / posScores.length : 0;
  const fpr = negScores.length ? fp / negScores.length : 0;
  return { tp, fp, precision, recall, fpr };
}
const pct = (x) => `${(x * 100).toFixed(2)}%`;

// ── --selftest: offline, synthetic, proves the pipeline end to end ─
if (args.includes('--selftest')) {
  const rnd = mulberry32(7);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const words = ['shop', 'news', 'blog', 'cloud', 'studio', 'market', 'travel', 'hotel', 'music', 'garden', 'river', 'stone', 'bridge', 'castle', 'kitchen', 'light', 'water', 'spring', 'field', 'harbor'];
  const phishy = ['login', 'verify', 'secure', 'account', 'update', 'signin', 'wallet', 'support', 'billing', 'confirm'];
  const brands = ['paypal', 'apple', 'amazon', 'netflix', 'chase', 'microsoft', 'coinbase', 'dhl', 'facebook', 'metamask'];
  const tlds = ['xyz', 'top', 'cf', 'ml', 'live', 'info', 'support'];
  const pos = [], neg = [];
  for (let i = 0; i < 1500; i++) {
    pos.push(`${pick(brands)}-${pick(phishy)}-${pick(phishy)}${rnd() < 0.5 ? Math.floor(rnd() * 999) : ''}.${pick(tlds)}`);
    neg.push(`${pick(words)}${rnd() < 0.5 ? pick(words) : ''}.${rnd() < 0.8 ? 'com' : 'org'}`);
  }
  const ml = { version: 2, ngrams: [3, 4, 5], buckets: 4096 };
  const hosts = [...pos, ...neg];
  const y = new Uint8Array(hosts.length).fill(1, 0, pos.length);
  const { w, b } = train(featurize(hosts, ml), y, { buckets: ml.buckets, epochs: 3, lr: LR, l2: L2, seed: SEED, log: false });
  const { q, scale, bias } = quantise(w, b);
  const model = toWeightsFile(q, scale, bias, ml.buckets, 0.5, {});
  const ps = scoreAll(model, pos), ns = scoreAll(model, neg);
  const r = prf(ps, ns, 0.5);
  console.log(`selftest: recall ${pct(r.recall)} fpr ${pct(r.fpr)} at 0.5; paypal-login-verify.xyz -> ${mlPredict(model, 'paypal-login-verify.xyz').toFixed(3)}, rivergarden.com -> ${mlPredict(model, 'rivergarden.com').toFixed(3)}`);
  console.log('top features:', mlTopFeatures(model, 'paypal-login-verify.xyz').map((f) => f.token).join(' '));
  assert.ok(r.recall > 0.95 && r.fpr < 0.05, 'synthetic classes must separate');
  assert.ok(mlPredict(model, 'paypal-login-verify.xyz') > 0.5);
  assert.ok(mlPredict(model, 'rivergarden.com') < 0.5);
  assert.ok(pickThreshold(ns, 0.01) <= 0.999);
  console.log('selftest ok');
  process.exit(0);
}

// ── main ─────────────────────────────────────────────────────────
const t0 = Date.now();
const majestic = await loadMajestic();
const phishRaw = await loadPhishHosts();

const negSet = new Set();
for (const d of majestic) negSet.add(mlNormHost(d));
const neg = [...negSet];
const posSet = new Set();
let ipDropped = 0, overlap = 0;
for (const h of phishRaw) {
  const n = mlNormHost(h);
  if (!n || !n.includes('.')) continue;
  if (isIpAddress(n)) { ipDropped++; continue; } // S17 never runs on IP hosts
  if (negSet.has(n)) { overlap++; continue; }     // a Majestic host keeps its legit label
  posSet.add(n);
}
const pos = [...posSet];
console.log(`dataset: ${pos.length} positives (feeds; dropped ${ipDropped} IPs, ${overlap} Majestic overlaps), ${neg.length} negatives (Majestic)`);

const rnd = mulberry32(SEED);
shuffle(pos, rnd);
shuffle(neg, rnd);
const posHold = Math.floor(pos.length * HOLDOUT), negHold = Math.floor(neg.length * HOLDOUT);
const posTest = pos.slice(0, posHold), posTrain = pos.slice(posHold);
const negTest = neg.slice(0, negHold), negTrain = neg.slice(negHold);
console.log(`split: train ${posTrain.length}+${negTrain.length}, held-out ${posTest.length}+${negTest.length} (${pct(HOLDOUT)} per class, seed ${SEED})`);

const psl = JSON.parse(readFileSync(join(root, 'src/data/psl.json'), 'utf8')).suffixes;
const prefixPool = harvestPrefixes(negTrain, psl);
const augNeg = [];
for (let i = 0; i < Math.floor(negTrain.length * SUB_AUG); i++) {
  // most prefixes come from the harvested Majestic distribution; a share uses the
  // generic infrastructure labels every organisation has (the feeds are full of
  // compromised mail. hosts, which must not make every webmail look phishy)
  const pool = rnd() < GENERIC_SHARE ? GENERIC_PREFIXES : prefixPool;
  augNeg.push(`${pool[Math.floor(rnd() * pool.length)]}.${negTrain[Math.floor(rnd() * negTrain.length)]}`);
}
// Benign tenants: the feeds are full of phishing under hosting suffixes (weebly.com,
// netlify.app, 000webhostapp.com...), so without counterexamples the model learns the
// SUFFIX and flags every innocent tenant. Pair legit Majestic names with those
// suffixes so only a phishy tenant NAME fires, not the platform itself.
const ccSld = new Set(['co', 'org', 'ac', 'gov', 'net', 'com', 'edu', 'mil', 'or', 'ne', 'go', 'in', 'nom', 'asn', 'id', 'sch', 'ltd', 'plc', 'me', 'priv']);
const hostingSuffixes = psl.filter((s) => {
  const parts = s.split('.');
  return parts.length >= 2 && !(ccSld.has(parts[0]) && parts[parts.length - 1].length === 2);
});
const tenantNeg = [];
for (let i = 0; i < TENANT_AUG; i++) {
  const base = negTrain[Math.floor(rnd() * negTrain.length)].split('.')[0];
  tenantNeg.push(`${base}.${hostingSuffixes[Math.floor(rnd() * hostingSuffixes.length)]}`);
}

const dgaPos = [];
for (let i = 0; i < DGA_POS; i++) dgaPos.push(dgaHost(rnd));
console.log(`augmented: +${augNeg.length} subdomain negatives (${new Set(prefixPool).size} real prefixes + ${GENERIC_PREFIXES.length} generic), +${tenantNeg.length} benign tenants under ${hostingSuffixes.length} hosting suffixes, +${dgaPos.length} synthetic DGA positives`);

// Rank weighting: a false positive on a top-100k site costs far more than one on
// rank 900k, so the training copies of top-100k negatives are repeated TOP_WEIGHT times.
const topSet = new Set(majestic.slice(0, 100000).map(mlNormHost));
const topNeg = negTrain.filter((h) => topSet.has(h));
const topExtra = [];
for (let i = 1; i < TOP_WEIGHT; i++) topExtra.push(...topNeg);
console.log(`rank weighting: ${topNeg.length} top-100k negatives in the training split, repeated x${TOP_WEIGHT}`);

const mlShape = { version: 2, ngrams: [3, 4, 5], buckets: BUCKETS };
const trainPos = [...posTrain, ...dgaPos];
const trainHosts = [...trainPos, ...negTrain, ...augNeg, ...tenantNeg, ...topExtra];
const y = new Uint8Array(trainHosts.length).fill(1, 0, trainPos.length);
console.log(`featurising ${trainHosts.length} hosts into ${BUCKETS} buckets...`);
const feat = featurize(trainHosts, mlShape);
console.log(`  ${feat.off[trainHosts.length]} ids, ${(feat.off[trainHosts.length] / trainHosts.length).toFixed(1)} per host`);

const { w, b } = train(feat, y, { buckets: BUCKETS, epochs: EPOCHS, lr: LR, l2: L2, seed: SEED, log: true });
const { q, scale, bias } = quantise(w, b);

// Everything below scores with the QUANTISED model through the shipped inference code.
let model = toWeightsFile(q, scale, bias, BUCKETS, 0.5, {});
const ps = scoreAll(model, posTest), ns = scoreAll(model, negTest);
const threshold = pickThreshold(ns, MAX_FPR);
const strict = pickThreshold(ns, STRICT_FPR);
model.threshold = threshold;

console.log('\n== held-out evaluation (quantised int8 model) ==');
for (const [label, th] of [[`chosen threshold ${threshold} (FPR <= ${pct(MAX_FPR)})`, threshold], [`strict threshold ${strict} (FPR <= ${pct(STRICT_FPR)})`, strict], ['threshold 0.5', 0.5]]) {
  const r = prf(ps, ns, th);
  console.log(`${label}: precision ${pct(r.precision)}, recall ${pct(r.recall)}, fpr ${pct(r.fpr)} (tp ${r.tp}, fp ${r.fp})`);
}

// What scripts/fp-audit.mjs measures: the top 100,000 Majestic rows.
const top = majestic.slice(0, 100000).map(mlNormHost);
const ts = scoreAll(model, top);
const hist = new Array(10).fill(0);
for (const s of ts) hist[Math.min(9, Math.floor(s * 10))]++;
console.log('\n== top 100,000 Majestic rows ==');
console.log(`score histogram (0.0-0.1 ... 0.9-1.0): ${hist.join(' ')}`);
console.log(`>= threshold ${threshold}: ${ts.filter((s) => s >= threshold).length}   >= strict ${strict}: ${ts.filter((s) => s >= strict).length}   >= 0.5: ${ts.filter((s) => s >= 0.5).length}`);
const worst = top.map((h, i) => [h, ts[i]]).filter((x) => x[1] >= threshold).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`highest-scoring: ${worst.map(([h, s]) => `${h} ${s.toFixed(2)}`).join(', ')}`);

// Distribution shift check: Majestic lists mostly bare registrable domains, real
// browsing hits subdomains. Prefix held-out negatives with common legit subdomains.
const prefixes = ['mail', 'login', 'accounts', 'docs', 'shop', 'm', 'app', 'api', 'blog', 'support'];
const subBase = negTest.slice(0, 5000);
const perPrefix = prefixes.map((p) => `${p} ${pct(scoreAll(model, subBase.map((h) => `${p}.${h}`)).filter((s) => s >= threshold).length / subBase.length)}`);
console.log(`\nlegit-subdomain shift check (prefix . held-out negative, share firing at threshold): ${perPrefix.join(', ')}`);
const realSub = negTest.filter((h) => { const r = registrableDomain(h, psl); return r && r !== h; });
const rs = scoreAll(model, realSub);
console.log(`held-out Majestic rows that carry a real subdomain (${realSub.length}): ${pct(rs.filter((s) => s >= threshold).length / rs.length)} fire at threshold`);
const dgaTest = Array.from({ length: 5000 }, () => dgaHost(rnd));
const ds = scoreAll(model, dgaTest);
console.log(`fresh synthetic DGA hosts (${dgaTest.length}): ${pct(ds.filter((s) => s >= threshold).length / ds.length)} fire at threshold`);

// Sanity hosts, for the eye.
console.log('\n== spot checks ==');
for (const h of ['paypal-login-verify.com', 'secure-appleid.support', 'login-microsoft-365.weebly.com', 'xqzkvwqt.com', 'wikipedia.org', 'google.com', 'github.com', 'tbcbank.ge', 'mail.google.com', 'docs.github.com']) {
  console.log(`  ${h.padEnd(34)} ${mlPredict(model, h).toFixed(3)}  ${mlTopFeatures(model, h).map((f) => f.token).join(' ')}`);
}

model = toWeightsFile(q, scale, bias, BUCKETS, threshold, {
  date: new Date().toISOString().slice(0, 10),
  positives: pos.length,
  negatives: neg.length,
  epochs: EPOCHS,
  heldOut: { precision: Number(prf(ps, ns, threshold).precision.toFixed(4)), recall: Number(prf(ps, ns, threshold).recall.toFixed(4)), fpr: Number(prf(ps, ns, threshold).fpr.toFixed(5)) }
});
const outPath = join(root, 'src/data/ml-weights.json');
const json = JSON.stringify(model) + '\n';
writeFileSync(outPath, json);
console.log(`\nwrote ${outPath} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
