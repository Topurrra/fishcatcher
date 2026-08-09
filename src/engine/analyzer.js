// Pure URL analysis: string in → {score, level, reasons} out. No extension APIs.
import { runSignals, isIpAddress } from './signals.js';
import { registrableDomain } from './psl.js';

export function levelForScore(score) {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 20) return 'elevated';
  return 'low';
}

// data: { safeList: Set<string>, brands, tlds, keywords, psl }
export function analyzeUrl(input, data) {
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

  if (data.safeList.has(registrable)) return result;

  const { score, reasons } = runSignals({ url, host, registrable }, data);
  result.score = Math.min(100, score);
  result.level = levelForScore(result.score);
  result.reasons = reasons;
  return result;
}
