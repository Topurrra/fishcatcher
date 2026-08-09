// Tiny lexical model (logistic regression) for DGA/random-domain detection.
// Weights + a bigram table learned from the legit corpus are shipped as JSON
// (scripts/train-ml.mjs); inference is a dot product, zero dependencies.
export function mlFeatures(sld, bigramSet) {
  const chars = [...sld.toLowerCase()];
  const n = chars.length || 1;
  const vowels = chars.filter((c) => 'aeiou'.includes(c)).length;
  const digits = chars.filter((c) => c >= '0' && c <= '9').length;
  const hyphens = chars.filter((c) => c === '-').length;
  const freq = {};
  for (const c of chars) freq[c] = (freq[c] ?? 0) + 1;
  let entropy = 0;
  for (const c in freq) {
    const p = freq[c] / n;
    entropy -= p * Math.log2(p);
  }
  let run = 0, maxRun = 0;
  for (const c of chars) {
    if (/[bcdfghjklmnpqrstvwxyz]/.test(c)) {
      run++;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 0;
    }
  }
  let bigramHits = 0;
  if (bigramSet) {
    for (let i = 0; i < chars.length - 1; i++) {
      if (bigramSet.has(chars[i] + chars[i + 1])) bigramHits++;
    }
  }
  const rare = chars.filter((c) => 'jqxz'.includes(c)).length;
  return [
    Math.min(1, chars.length / 20),
    vowels / n,
    digits / n,
    Math.min(1, hyphens / 4),
    Math.min(1, entropy / 4.5),
    Math.min(1, maxRun / 6),
    chars.length > 1 ? bigramHits / (chars.length - 1) : 0,
    rare / n
  ];
}

export function mlPredict(ml, sld) {
  if (!ml._set) ml._set = new Set(ml.bigrams ?? []);
  const f = mlFeatures(sld, ml._set);
  let z = ml.bias;
  for (let i = 0; i < f.length; i++) {
    const v = ml.featStd?.[i] ? (f[i] - (ml.featMean?.[i] ?? 0)) / ml.featStd[i] : f[i];
    z += ml.weights[i] * v;
  }
  return 1 / (1 + Math.exp(-z));
}
