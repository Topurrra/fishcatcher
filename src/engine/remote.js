// Remote threat bundle: signature check + apply. Pure where possible; the
// WebCrypto verify is async and works in Node 20+, Chrome and Firefox alike.
import { Bloom } from './bloom.js';

// The exact bytes the registry signs: these fields, in this order, no sig.
export function bundlePayload(bundle) {
  return JSON.stringify({
    version: bundle.version,
    generated: bundle.generated,
    sources: bundle.sources,
    count: bundle.count,
    bloom: bundle.bloom
  });
}

function b64ToBytes(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ECDSA P-256 / SHA-256 over bundlePayload(bundle), signature as raw r||s
// (IEEE P1363) base64 in bundle.sig. key = { spki: base64 } from data/registry-key.json.
export async function verifyBundle(bundle, key, subtle = globalThis.crypto?.subtle) {
  if (!bundle || typeof bundle.sig !== 'string' || !key?.spki || !subtle) return false;
  try {
    const pub = await subtle.importKey('spki', b64ToBytes(key.spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = new TextEncoder().encode(bundlePayload(bundle));
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64ToBytes(bundle.sig), data);
  } catch {
    return false;
  }
}

// Applies a verified bundle onto the current data object. Only the community
// blocklist and the Bloom feed may change: the safe list, brands, TLD weights
// and keywords are code-shipped and a feed must never be able to widen them.
export function applyBundle(data, bundle) {
  const next = { ...data };
  if (Array.isArray(bundle.blocklist)) next.blockList = new Set(bundle.blocklist);
  if (bundle.bloom?.m && bundle.bloom?.bits) next.bloom = Bloom.fromPayload(bundle.bloom);
  return next;
}
