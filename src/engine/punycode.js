// Punycode (RFC 3492) decoding + homoglyph normalization.
// No dependencies — runs identically in Node tests and the extension.

const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 0x80;

function adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) / 2) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function decodeDigit(cp) {
  if (cp - 48 < 10) return cp - 22;
  if (cp - 65 < 26) return cp - 65;
  if (cp - 97 < 26) return cp - 97;
  return BASE;
}

export function punyDecode(input) {
  const output = [];
  const delim = input.lastIndexOf('-');
  let i = 0, bias = INITIAL_BIAS, n = INITIAL_N;
  for (let j = 0; j < delim; j++) output.push(input.charCodeAt(j));
  let index = delim < 0 ? 0 : delim + 1;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('invalid punycode');
      const digit = decodeDigit(input.charCodeAt(index++));
      if (digit > Math.floor((0x7fffffff - i) / w)) throw new Error('punycode overflow');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

// Decodes every xn-- label of a hostname; other labels pass through.
export function decodeHost(host) {
  return host
    .split('.')
    .map((label) => (label.startsWith('xn--') ? punyDecode(label.slice(4)) : label))
    .join('.');
}

// Confusable non-ASCII characters folded to their Latin look-alikes.
const HOMOGLYPHS = {
  'а': 'a', 'е': 'e', 'о': 'o', 'с': 'c', 'р': 'p', 'х': 'x', 'у': 'y', 'ѕ': 's',
  'і': 'i', 'ј': 'j', 'ԁ': 'd', 'ɡ': 'g', 'һ': 'h', 'κ': 'k', 'м': 'm', 'т': 't',
  'в': 'b', 'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'ν': 'v', 'ω': 'w',
  'ｌ': 'l', '０': '0', '１': '1', '２': '2', '５': '5', '－': '-'
};

export function asciiFold(text) {
  let out = '';
  for (const ch of text) out += HOMOGLYPHS[ch] ?? ch;
  return out;
}

const isLatin = (ch) => /[a-z0-9]/.test(ch);
const isCyrillic = (ch) => /[а-яіїѓѕјԁһ]/.test(ch);
const isGreek = (ch) => /[α-ω]/.test(ch);

// Mixed scripts in one host is a strong IDN-attack indicator.
export function hasMixedScripts(text) {
  let latin = false, cyrillic = false, greek = false;
  for (const ch of text) {
    if (isLatin(ch)) latin = true;
    else if (isCyrillic(ch)) cyrillic = true;
    else if (isGreek(ch)) greek = true;
  }
  return (latin && cyrillic) || (latin && greek) || (cyrillic && greek);
}
