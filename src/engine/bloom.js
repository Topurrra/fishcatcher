// Minimal Bloom filter (FNV-1a double hashing) for compact community feeds.
// Lets the remote update channel ship ~100k known-bad domains in a few hundred KB.
export function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Bloom {
  constructor(m, k, seed = 1) {
    this.m = m;
    this.k = k;
    this.seed = seed;
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }

  _hashes(s) {
    return [fnv1a(s, 0x811c9dc5 ^ this.seed), fnv1a(s, 0x01000193 + this.seed)];
  }

  add(s) {
    const [h1, h2] = this._hashes(s);
    for (let i = 0; i < this.k; i++) {
      // >>> 0 keeps the index unsigned: Math.imul returns a signed 32-bit int,
      // and a negative bit would silently no-op the write (false negatives).
      const bit = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      this.bits[bit >> 3] |= 1 << (bit & 7);
    }
  }

  has(s) {
    const [h1, h2] = this._hashes(s);
    for (let i = 0; i < this.k; i++) {
      const bit = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      if (!(this.bits[bit >> 3] & (1 << (bit & 7)))) return false;
    }
    return true;
  }

  toBase64() {
    let bin = '';
    for (let i = 0; i < this.bits.length; i++) bin += String.fromCharCode(this.bits[i]);
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  }

  static fromPayload(p) {
    const b = new Bloom(p.m, p.k, p.seed ?? 1);
    const bin = typeof atob === 'function' ? atob(p.bits) : Buffer.from(p.bits, 'base64').toString('binary');
    for (let i = 0; i < b.bits.length && i < bin.length; i++) b.bits[i] = bin.charCodeAt(i);
    return b;
  }
}
