// Pure URL analysis: string in → {score, level, reasons} out. No extension APIs.
import { runSignals, isIpAddress } from './signals.js';
import { runAitm } from './aitm.js';
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

  // Softer allowlist: known-legitimate domains still get scored, but brand-
  // impersonation signals are suppressed (see signals.js) to avoid flagging
  // sites like google.ca or github.io. A blocklist/ML/TLD hit can still fire.
  const knownLegit = !!data.safeBloom?.has(registrable);
  const { score: baseScore, reasons } = runSignals({ url, host, registrable, knownLegit }, data);
  let score = baseScore;

  // S13 — login form on a domain that is neither safe-listed nor trusted
  if (opts?.hasPasswordForm) {
    score += 20;
    reasons.push({ key: 'reasonPasswordForm', params: [], weight: 20 });
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
  }

  result.score = Math.min(100, score);
  result.level = levelForScore(result.score);
  result.reasons = reasons;
  return result;
}
