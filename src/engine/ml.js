// Hashed character n-gram logistic regression over the full hostname (S17).
// Trained offline on phishing-feed hosts vs Majestic Million (scripts/train-ml.mjs);
// weights ship as an int8 table in src/data/ml-weights.json. Inference: hash the
// n-grams of "^host$" (plus a few cheap shape tokens) with fnv1a into B buckets,
// sum the int8 weights, scale, sigmoid. Zero dependencies.
import { fnv1a } from './bloom.js';

const ML_NGRAMS = [3, 4, 5];

export function mlNormHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return h.startsWith('www.') ? h.slice(4) : h;
}

// Feature tokens: n-grams over the boundary-marked host, then shape tokens.
// Same function for training and inference, so the two can never disagree.
export function mlTokens(ml, host) {
  const h = mlNormHost(host);
  const s = '^' + h + '$';
  const sizes = ml.ngrams ?? ML_NGRAMS;
  const out = [];
  for (const n of sizes) for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  const labels = h.split('.');
  const n = h.length || 1;
  let digits = 0, hyphens = 0, vowels = 0, run = 0, maxRun = 0;
  for (let i = 0; i < h.length; i++) {
    const c = h[i];
    if (c >= '0' && c <= '9') digits++;
    else if (c === '-') hyphens++;
    else if ('aeiou'.includes(c)) vowels++;
    // consonant run: random letter soup (DGA) piles consonants up, words do not
    run = c >= 'a' && c <= 'z' && !'aeiouy'.includes(c) ? run + 1 : 0;
    if (run > maxRun) maxRun = run;
  }
  const dig = Math.min(5, Math.round((digits / n) * 10));
  const vow = Math.min(5, Math.round((vowels / n) * 10));
  const runB = Math.min(7, maxRun);
  out.push('len:' + Math.min(12, h.length >> 2));
  out.push('dig:' + dig);
  out.push('vow:' + vow);
  out.push('run:' + runB);
  out.push('shp:' + runB + ':' + vow + ':' + dig); // one conjunction so a linear model can see "letter soup"
  out.push('hy:' + Math.min(4, hyphens));
  out.push('lab:' + Math.min(5, labels.length));
  out.push('tld:' + labels[labels.length - 1]);
  return out;
}

function mlTable(ml) {
  if (!ml._w) {
    const bin = typeof atob === 'function' ? atob(ml.table) : Buffer.from(ml.table, 'base64').toString('binary');
    const w = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) w[i] = (bin.charCodeAt(i) << 24) >> 24;
    ml._w = w;
  }
  return ml._w;
}

// Probability that the host looks like a phishing-feed address (0..1).
export function mlPredict(ml, host) {
  if (!ml || ml.version !== 2 || !ml.table) return 0; // old or missing weights: never fire
  const w = mlTable(ml);
  const B = ml.buckets;
  const seen = new Set();
  let sum = 0;
  for (const t of mlTokens(ml, host)) {
    const id = fnv1a(t) % B;
    if (seen.has(id)) continue; // binary presence
    seen.add(id);
    sum += w[id];
  }
  const z = ml.bias + ml.scale * sum;
  return 1 / (1 + Math.exp(-z));
}

// Top n tokens pushing the score up, for the panel: [{ token, weight }].
export function mlTopFeatures(ml, host, n = 3) {
  if (!ml || ml.version !== 2 || !ml.table) return [];
  const w = mlTable(ml);
  const best = new Map();
  for (const t of mlTokens(ml, host)) {
    const v = w[fnv1a(t) % ml.buckets] * ml.scale;
    if (v > 0 && !best.has(t)) best.set(t, v);
  }
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, n).map(([token, weight]) => ({ token, weight }));
}
