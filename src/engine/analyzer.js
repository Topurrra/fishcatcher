// Pure URL analysis: string in → {score, level, reasons} out. No extension APIs.
import { runSignals, isIpAddress, isLocalHost } from './signals.js';
import { runAitm } from './aitm.js';
import { runFormAction } from './formaction.js';
import { runScamPacks } from './scampacks.js';
import { registrableDomain } from './psl.js';

export function levelForScore(score) {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 20) return 'elevated';
  return 'low';
}

// data: { safeList: Set<string>, brands, tlds, keywords, psl, blockList?, trustList? }
// opts: { hasPasswordForm?, youngDomainDays?, aitm? } — page-content signals from the probe content script
export function analyzeUrl(input, data, opts) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const registrable = isIpAddress(host) ? host : registrableDomain(host, data.psl);
  const result = { url: input, host, registrable, score: 0, level: 'low', reasons: [] };

  if (data.safeList.has(registrable) || data.trustList?.has(registrable)) return result;

  // localhost / loopback / private-LAN addresses are developer and home-network
  // hosts, never phishing targets, so they stay quiet (including on plain http).
  if (isLocalHost(host)) return result;

  // Softer allowlist: known-legitimate domains still get scored, but brand-
  // impersonation signals are suppressed (see signals.js) to avoid flagging
  // sites like google.ca or github.io. A blocklist/ML/TLD hit can still fire.
  const knownLegit = !!data.safeBloom?.has(registrable);
  const { score: baseScore, reasons } = runSignals({ url, host, registrable, knownLegit }, data);
  let score = baseScore;

  // S13 — login form on a domain that is neither safe-listed nor trusted.
  // Half weight on a known-legit (top-100k) domain: a login form there is normal.
  if (opts?.hasPasswordForm) {
    const w = knownLegit ? 10 : 20;
    score += w;
    reasons.push({ key: 'reasonPasswordForm', params: [], weight: w });
  }

  // S15 — freshly registered domain (opt-in RDAP cloud check)
  if (opts?.youngDomainDays != null) {
    score += 25;
    reasons.push({ key: 'reasonYoungDomain', params: [String(opts.youngDomainDays)], weight: 25 });
  }

  // S18 — Google Safe Browsing (opt-in): authoritative third-party verdict.
  // opts.gsbThreat is the pre-mapped reason key (reasonGsbMalware, etc.).
  if (opts?.gsbThreat) {
    score += 60;
    reasons.push({ key: opts.gsbThreat, params: [], weight: 60 });
  }

  // M8 — AiTM composite (identity interaction + claimed brand + origin mismatch).
  // No opts.aitm (e.g. the verify.mjs corpora) leaves this untouched → no regression.
  if (opts?.aitm) {
    const a = runAitm({ registrable, knownLegit, aitm: opts.aitm }, data);
    score += a.score;
    for (const r of a.reasons) reasons.push(r);
    // S20: login form posts to a foreign domain (rides in the same payload).
    const f = runFormAction({ registrable, knownLegit, aitm: opts.aitm }, data);
    score += f.score;
    for (const r of f.reasons) reasons.push(r);
  }

  // Scam packs — crypto seed-phrase request, or tech-support locker scare.
  // No opts.scam (e.g. the verify.mjs corpora) leaves this untouched → no regression.
  if (opts?.scam) {
    const s = runScamPacks({ scam: opts.scam, knownLegit }, data);
    score += s.score;
    for (const r of s.reasons) reasons.push(r);
  }

  result.score = Math.min(100, score);
  result.level = levelForScore(result.score);
  result.reasons = reasons;
  return result;
}

// Brand the page impersonates, as a domain the UI can offer to open instead.
// reasonBrand carries the brand domain; the others carry the brand name.
export function realSiteFor(reasons, brands) {
  for (const r of reasons ?? []) {
    if (r.key === 'reasonBrand' && r.params[0]) return r.params[0];
    if (r.key === 'reasonHomoglyph' || r.key === 'reasonBrandSubdomain' || r.key === 'reasonAitmMismatch') {
      const b = brands.find((x) => x.name === r.params[0]);
      if (b?.domains?.[0]) return b.domains[0];
    }
  }
  return undefined;
}
