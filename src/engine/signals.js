// S1–S11 red-flag signals. Each match contributes a weight and an i18n reason key.
import { decodeHost, asciiFold, hasMixedScripts } from './punycode.js';
import { registrableDomain, sldOf } from './psl.js';

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function isIpAddress(host) {
  if (host.startsWith('[')) return true; // IPv6 literal
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function runSignals(ctx, data) {
  const { url, host } = ctx;
  const reasons = [];
  let score = 0;
  const add = (weight, key, params = []) => {
    score += weight;
    reasons.push({ key, params, weight });
  };

  const decoded = decodeHost(host);
  const folded = asciiFold(decoded);
  const foldedRegistrable = registrableDomain(folded, data.psl);
  const sld = sldOf(ctx.registrable);

  // S1 — brand impersonation via typo (Levenshtein ≤ 2)
  for (const brand of data.brands) {
    const hit = brand.domains.find((d) => d !== ctx.registrable && levenshtein(ctx.registrable, d) <= 2);
    if (hit) {
      add(45, 'reasonBrand', [hit, ctx.registrable]);
      break;
    }
  }

  // S2 — homoglyph / IDN attack
  if (decoded !== host) {
    const brandHit = data.brands.find((b) =>
      b.domains.some((d) => levenshtein(foldedRegistrable, d) <= 2)
    );
    if (brandHit || hasMixedScripts(decoded)) {
      add(45, 'reasonHomoglyph', [brandHit?.name ?? '']);
    }
  }

  // S3 — brand name present but registrable domain is not the brand's
  for (const brand of data.brands) {
    if (brand.domains.includes(ctx.registrable)) continue;
    const kw = brand.keywords.find((k) => host.includes(k));
    if (kw) {
      add(40, 'reasonBrandSubdomain', [brand.name]);
      break;
    }
  }

  // S4 — raw IP address as host; domain-shape signals (S8, S10, S11) don't apply to IPs
  const isIp = isIpAddress(host);
  if (isIp) add(35, 'reasonIp');

  // S5 — user@ trick (browser ignores everything before @)
  if (url.username.includes('.')) add(35, 'reasonAtSign');

  // S6 — high-abuse TLD
  const tld = host.split('.').pop();
  if (data.tlds[tld]) add(data.tlds[tld], 'reasonTld', [tld]);

  // S7 — phishy keyword in host
  const keyword = data.keywords.find((k) => host.includes(k));
  if (keyword) add(15, 'reasonKeyword', [keyword]);

  // S8 — deep subdomain chain
  const labelCount = host.split('.').length;
  if (!isIp && labelCount >= 4) add(10, 'reasonSubdomains', [String(labelCount)]);

  // S9 — unencrypted connection
  if (url.protocol === 'http:') add(15, 'reasonHttp');

  // S10 — unusual digit/hyphen mix
  const hyphens = (host.match(/-/g) ?? []).length;
  const digitRatio = (sld.match(/\d/g) ?? []).length / sld.length;
  if (!isIp && (hyphens >= 3 || digitRatio > 0.4)) add(10, 'reasonDigits');

  // S11 — short random-looking domain
  if (!isIp && sld.length <= 6 && /\d/.test(sld)) add(5, 'reasonShort');

  return { score, reasons };
}
