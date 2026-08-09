// Trains the tiny lexical model offline and writes src/data/ml-weights.json.
// Legit corpus: Majestic Million top domains (public CSV, cached in scripts/data/)
// plus the bundled safe/brand lists and English word stems.
// Malicious corpus: synthetic DGA-style domains + bundled blocklist + phishing seeds.
// Deterministic given the cached corpus. Falls back to synthetic-only legit if
// the CSV is missing and the download fails.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mlFeatures } from '../src/engine/ml.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const WORDS = ['shop', 'store', 'news', 'blog', 'wiki', 'docs', 'mail', 'cloud', 'app', 'dev', 'studio', 'market', 'travel', 'hotel', 'learn', 'games', 'video', 'music', 'food', 'auto', 'jobs', 'home', 'life', 'world', 'tech', 'line', 'link', 'web', 'site', 'page', 'zone', 'space', 'place', 'point', 'center', 'group', 'team', 'plus', 'hub', 'lab', 'box', 'base', 'port', 'gate', 'way', 'path', 'spot', 'star', 'sun', 'moon', 'sky', 'sea', 'land', 'wood', 'field', 'brook', 'stone', 'ridge', 'apple', 'orange', 'river', 'mountain', 'garden', 'forest', 'meadow', 'harbor', 'bridge', 'castle', 'village', 'city', 'town', 'street', 'avenue', 'square', 'plaza', 'tower', 'house', 'office', 'school', 'college', 'library', 'museum', 'theater', 'cinema', 'bakery', 'kitchen', 'table', 'window', 'door', 'light', 'water', 'fire', 'earth', 'wind', 'rain', 'snow', 'spring', 'summer', 'autumn', 'winter'];

const MAJESTIC_URL = 'https://downloads.majestic.com/majestic_million.csv';
const cachePath = join(root, 'scripts', 'data', 'majestic_million.csv');

async function loadMajesticSlds() {
  let text = null;
  if (existsSync(cachePath)) {
    text = readFileSync(cachePath, 'utf8');
  } else {
    try {
      console.log('downloading Majestic Million (legit corpus, cached afterwards)...');
      const res = await fetch(MAJESTIC_URL);
      if (res.ok) {
        text = await res.text();
        mkdirSync(dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, text);
      }
    } catch {
      // offline training: synthetic-only fallback
    }
  }
  if (!text) return [];
  const slds = new Set();
  for (const line of text.split('\n').slice(1, 30001)) {
    const domain = line.split(',')[2]?.trim().toLowerCase();
    if (!domain) continue;
    const labels = domain.split('.');
    if (labels.length >= 2) slds.add(labels[labels.length - 2]);
  }
  return [...slds];
}

const VOWELS = 'aeiou', CONS = 'bcdfghjklmnpqrstvwxyz';
function dgaConsonantVowel(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += i % 2 ? pick([...VOWELS]) : pick([...CONS]);
  if (rnd() < 0.4) {
    const i = Math.floor(rnd() * (s.length - 1));
    s = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
  }
  if (rnd() < 0.3) s = s.slice(0, -2) + String(Math.floor(rnd() * 99));
  return s;
}
function dgaRandom(len) {
  const alpha = CONS + VOWELS;
  let s = '';
  for (let i = 0; i < len; i++) s += rnd() < 0.35 ? String(Math.floor(rnd() * 10)) : pick([...alpha]);
  return s;
}
function dgaUniform(len) {
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += pick([...alpha]);
  return s;
}

const safe = readJson('src/data/safe-list.json').domains;
const brands = readJson('src/data/brands.json').brands.flatMap((b) => b.domains);
const block = readJson('src/data/blocklist.json').domains;
const sldOf = (d) => d.split('.')[0];

const legit = new Set([...safe, ...brands].map(sldOf));
for (const w of WORDS) {
  legit.add(w);
  legit.add(w + 's');
  legit.add('my' + w);
  legit.add(w + 'ly');
  legit.add('the' + w);
}

const malicious = new Set(block.map(sldOf));
for (let i = 0; i < 600; i++) malicious.add(dgaUniform(8 + Math.floor(rnd() * 7)));
for (let i = 0; i < 200; i++) malicious.add(dgaConsonantVowel(8 + Math.floor(rnd() * 8)));
for (let i = 0; i < 200; i++) malicious.add(dgaRandom(8 + Math.floor(rnd() * 7)));

const main = async () => {
  for (const s of await loadMajesticSlds()) legit.add(s);
  console.log(`legit corpus: ${legit.size} samples`);

  // Bigram table = what legit domains actually look like (real corpus, not hand-picked).
  const bigramCounts = {};
  for (const s of legit) {
    const chars = [...s.toLowerCase()];
    for (let i = 0; i < chars.length - 1; i++) {
      const b = chars[i] + chars[i + 1];
      bigramCounts[b] = (bigramCounts[b] ?? 0) + 1;
    }
  }
  const minCount = legit.size >= 5000 ? 150 : 3;
  const bigrams = Object.keys(bigramCounts).filter((b) => bigramCounts[b] >= minCount);
  const bigramSet = new Set(bigrams);

  // Class balance (~3:1 legit:malicious) — without it the bias collapses and
  // the model predicts "legit" for everything.
  const legitArr = [...legit];
  for (let i = legitArr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [legitArr[i], legitArr[j]] = [legitArr[j], legitArr[i]];
  }
  const trainLegit = legitArr.slice(0, Math.min(legitArr.length, malicious.size * 3));

  const X = [], Y = [];
  for (const s of trainLegit) { X.push(mlFeatures(s, bigramSet)); Y.push(0); }
  for (const s of malicious) { X.push(mlFeatures(s, bigramSet)); Y.push(1); }

  const mean = (cls) => {
    const rows = X.filter((_, i) => Y[i] === cls);
    return rows[0].map((_, j) => (rows.reduce((s, r) => s + r[j], 0) / rows.length).toFixed(2));
  };
  console.log('feat means legit', mean(0), 'mal', mean(1));

  // Standardize, then full-batch logistic regression (stable on small data).
  const nf = X[0].length;
  const featMean = new Array(nf).fill(0);
  const featStd = new Array(nf).fill(0);
  for (const f of X) for (let j = 0; j < nf; j++) featMean[j] += f[j];
  for (let j = 0; j < nf; j++) featMean[j] /= X.length;
  for (const f of X) for (let j = 0; j < nf; j++) featStd[j] += (f[j] - featMean[j]) ** 2;
  for (let j = 0; j < nf; j++) featStd[j] = Math.sqrt(featStd[j] / X.length) || 1;
  const Z = X.map((f) => f.map((v, j) => (v - featMean[j]) / featStd[j]));

  const W = new Array(nf).fill(0);
  let B = 0;
  const lr = 1.0, epochs = 500, l2 = 1e-4;
  for (let e = 0; e < epochs; e++) {
    const gW = new Array(nf).fill(0);
    let gB = 0;
    for (let i = 0; i < Z.length; i++) {
      let z = B;
      for (let j = 0; j < nf; j++) z += W[j] * Z[i][j];
      const err = 1 / (1 + Math.exp(-z)) - Y[i];
      for (let j = 0; j < nf; j++) gW[j] += err * Z[i][j];
      gB += err;
    }
    for (let j = 0; j < nf; j++) W[j] -= (lr / Z.length) * (gW[j] + l2 * W[j]);
    B -= (lr / Z.length) * gB;
  }

  const predict = (f) => {
    let z = B;
    for (let j = 0; j < nf; j++) z += W[j] * ((f[j] - featMean[j]) / featStd[j]);
    return 1 / (1 + Math.exp(-z));
  };
  let correct = 0;
  for (let i = 0; i < X.length; i++) correct += (predict(X[i]) >= 0.5 ? 1 : 0) === Y[i] ? 1 : 0;
  const acc = correct / X.length;

  const threshold = 0.6;
  const weights = {
    version: 1,
    weights: W.map((w) => Number(w.toFixed(4))),
    bias: Number(B.toFixed(4)),
    featMean: featMean.map((v) => Number(v.toFixed(4))),
    featStd: featStd.map((v) => Number(v.toFixed(4))),
    threshold,
    bigrams
  };
  writeFileSync(join(root, 'src/data/ml-weights.json'), JSON.stringify(weights, null, 2) + '\n');
  console.log(`trained on ${X.length} samples, accuracy ${(acc * 100).toFixed(1)}%, threshold ${threshold}`);
  console.log('weights', weights.weights, 'bias', weights.bias);
};

main();
