// Applies a remote update bundle (v2) onto the current data object.
// Pure and testable; the background worker feeds it fetched JSON.
import { Bloom } from './bloom.js';

export function applyBundle(data, bundle) {
  const next = { ...data };
  if (Array.isArray(bundle.domains)) next.safeList = new Set(bundle.domains);
  if (Array.isArray(bundle.brands)) next.brands = bundle.brands;
  if (bundle.tlds && typeof bundle.tlds === 'object') next.tlds = bundle.tlds;
  if (Array.isArray(bundle.keywords)) next.keywords = bundle.keywords;
  if (Array.isArray(bundle.blocklist)) next.blockList = new Set(bundle.blocklist);
  if (bundle.bloom?.m && bundle.bloom?.bits) next.bloom = Bloom.fromPayload(bundle.bloom);
  return next;
}
