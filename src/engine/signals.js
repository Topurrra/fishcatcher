// S1–S17 red-flag signals. Each match contributes a weight and an i18n reason key.
import { decodeHost, asciiFold, hasMixedScripts } from './punycode.js';
import { registrableDomain, sldOf } from './psl.js';
import { mlPredict } from './ml.js';

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

// localhost / loopback / private-LAN / link-local. These are developer and home-network
// addresses, never a phishing target, so the engine leaves them alone (http is normal
// there too). Covers IPv4 and IPv6, bracketed or not.
export function isLocalHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const h6 = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h6 === '::1' || h6 === '::') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h6)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(h6)) return true;   // fe80::/10 link-local
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 127 || a === 0 || a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254);
}

const S3_DIGIT_FOLD = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a' };

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

  // S12 — known-bad domain on the local blocklist (exact or parent of host)
  let blockedHit = false;
  if (data.blockList) {
    for (const blocked of data.blockList) {
      if (ctx.registrable === blocked || host === blocked || host.endsWith('.' + blocked)) {
        blockedHit = true;
        break;
      }
    }
  }
  if (blockedHit) add(60, 'reasonBlocklist');
  else if (data.bloom?.has(ctx.registrable) || data.bloom?.has(host)) add(45, 'reasonBloom'); // S16 — community feed (probabilistic)

  // Brand-impersonation signals (S1–S3) are suppressed for domains on the
  // known-legitimate allowlist, and S1 for very short SLDs (edit-distance ≤ 2
  // collides with real brands by chance, e.g. ft.com, go.com, box.com).
  // Without this guard, google.ca / github.io / goo.gl / redhat.com all fire.
  if (!ctx.knownLegit) {
    // S1 — brand impersonation via typo (Levenshtein ≤ 2)
    if (sld.length >= 5) {
      for (const brand of data.brands) {
        const hit = brand.domains.find((d) => d !== ctx.registrable && levenshtein(ctx.registrable, d) <= 2);
        if (hit) {
          add(45, 'reasonBrand', [hit, ctx.registrable]);
          break;
        }
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

    // S3 — brand name present but registrable domain is not the brand's.
    // Only the attacker-controlled part of the host counts: the public suffix is
    // dropped so tenants of github.io / storage.googleapis.com do not hit their
    // own host's brand. Digit homoglyphs (amaz0n, paypa1) are folded too, but only
    // for keywords of 4+ chars so short ones (bog, tbc, aws) do not match noise.
    const owned = host.slice(0, host.length - (ctx.registrable.length - sld.length));
    const ownedFold = owned.replace(/[0134578@]/g, (c) => S3_DIGIT_FOLD[c]);
    for (const brand of data.brands) {
      if (brand.domains.includes(ctx.registrable)) continue;
      const kw = brand.keywords.find((k) => owned.includes(k) || (k.length >= 4 && ownedFold.includes(k)));
      if (kw) {
        add(40, 'reasonBrandSubdomain', [brand.name]);
        break;
      }
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

  // S7 — phishy keyword in host. Skipped on known-legitimate domains, where
  // login./secure./account. subdomains are the norm, not a tell.
  const keyword = ctx.knownLegit ? null : data.keywords.find((k) => host.includes(k));
  if (keyword) add(15, 'reasonKeyword', [keyword]);

  // S8 — deep subdomain chain: two or more labels below the registrable domain
  // (login.microsoft.com.evil.xyz fires, www.google.co.uk does not)
  const labelCount = host.split('.').length;
  const extraLabels = labelCount - ctx.registrable.split('.').length;
  if (!isIp && extraLabels >= 2) add(10, 'reasonSubdomains', [String(labelCount)]);

  // S9 — unencrypted connection
  if (url.protocol === 'http:') add(15, 'reasonHttp');

  // S10 — unusual digit/hyphen mix
  const hyphens = (host.match(/-/g) ?? []).length;
  const digitRatio = (sld.match(/\d/g) ?? []).length / sld.length;
  if (!isIp && (hyphens >= 3 || digitRatio > 0.4)) add(10, 'reasonDigits');

  // S11 — short random-looking domain
  if (!isIp && sld.length <= 6 && /\d/.test(sld)) add(5, 'reasonShort');

  // S17 — on-device n-gram model over the full host (minus www.): phishing-feed
  // address patterns (login-, -verify, hosting tenants, abused TLDs) and DGA names
  if (!isIp && data.ml && mlPredict(data.ml, host) >= (data.ml.threshold ?? 0.6)) add(20, 'reasonMl');

  return { score, reasons };
}
