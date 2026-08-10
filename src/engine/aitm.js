// M8 — AiTM (adversary-in-the-middle) core. Pure: DOM-derived facts in, reasons
// out. No chrome/DOM APIs. Bundled into background.js AND probe.js by build.mjs.
// Every top-level name is aitm-prefixed for the bundler's uniqueness rule.
//
// PRIMARY detection = identity/security interaction + inferred brand + origin
// mismatch, ALL three. Proxy/keyword/hostname-substring alone never score:
// the soft corroborators (resource-graph, favicon drift) are only ever appended
// AFTER the primary fires, which structurally enforces the hard FP rule.
import { registrableDomain } from './psl.js';

// Canonical identity/security interaction kinds (Signal 1). The content script
// only ever emits values from this set.
export const AITM_INTERACTION_KINDS = ['password', 'otp', 'mfaApproval', 'deviceCode', 'passkey', 'mfaMigration', 'ssoSetup', 'qrAuth', 'helpdeskUpgrade'];

// Calibration knobs — exported so tests pin behaviour and tuning is one line.
export const AITM_PRIMARY_WEIGHT = 55; // composite strong flag → 'high' alone
export const AITM_GRAPH_WEIGHT = 15;   // Signal 2 corroborator
export const AITM_DRIFT_WEIGHT = 5;    // Signal 4 boost
const AITM_GRAPH_DOMINANCE = 0.8;      // fraction of resources under one origin
const AITM_GRAPH_MIN_RESOURCES = 5;    // don't judge tiny pages
const AITM_GRAPH_MIN_ANOMALIES = 2;    // both anomalies needed to corroborate

// One control's accessible text → interaction kind. First match wins. EN with
// cheap KA/RU tokens. Order matters: narrower prompts before the bare
// "password" fallback so "one-time password" classifies as otp, not password.
const AITM_KIND_PATTERNS = [
  ['otp', /\b(one[\s-]?time (code|password|passcode)|verification code|security code|6[\s-]?digit code|enter the code)\b|ერთჯერად|код подтвержд/i],
  ['mfaApproval', /\b((approve|deny|verify) (this )?(sign[\s-]?in|request|login)|open your authenticator|check your (phone|authenticator)|number matching|(enter|tap|select|match) the number( shown)?)\b/i],
  ['mfaMigration', /\b((migrate|re[\s-]?enroll|re[\s-]?register|update|move) your (mfa|authenticator|2fa|multi[\s-]?factor)|authenticator migration)\b/i],
  ['passkey', /\b(set ?up|create|add|register|enroll|use|sign in with) (a )?(passkey|security key|fido2? key|face ?id|touch ?id|windows hello)\b/i],
  ['ssoSetup', /\b(set ?up|configure|enable) (single sign[\s-]?on|sso|federation|saml|oidc)\b/i],
  ['qrAuth', /\bscan (this|the) qr( code)?\b.{0,40}\b(sign in|log ?in|authenticate|link|pair)\b/i],
  ['helpdeskUpgrade', /\b((security|account|mfa|password) (upgrade|migration|re[\s-]?validation|re[\s-]?verification) (required|needed)|verify your account to continue)\b/i],
  ['password', /\b(pass(word|phrase))\b|პაროლ|парол/i]
];

export function aitmKindForText(text) {
  if (!text) return null;
  for (const [kind, re] of AITM_KIND_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

// ponytail: naive IP check so registrableDomain doesn't mangle IP resource
// hosts. Upgrade to signals.js isIpAddress only if it ever moves into this bundle.
function aitmIsIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
}

// identityHints = { title, ogSiteName, logoAlts:[], brandTokens:[] }. The claimed
// PRIMARY identity is inferred ONLY from the page's own self-identity (title,
// og:site_name, logo alt), NOT from brandTokens (form buttons/labels): a
// legitimate SaaS's "Sign in with Google" button lives in brandTokens and would
// otherwise be read as the page claiming to BE Google, flagging every federated
// login. Conservative: empty strong hints → [].
export function aitmInferBrands(identityHints, data) {
  const h = identityHints ?? {};
  const hay = [h.title ?? '', h.ogSiteName ?? '', ...(h.logoAlts ?? [])].join(' ').toLowerCase();
  if (!hay.trim()) return [];
  const names = [];
  for (const brand of data.brands) {
    if (hay.includes(brand.name.toLowerCase()) || brand.keywords.some((k) => hay.includes(k.toLowerCase()))) {
      names.push(brand.name);
    }
  }
  return [...new Set(names)];
}

// First claimed brand whose .domains does NOT include the origin's registrable,
// else null. Allowlists are gated by the caller (runAitm) before this runs.
export function aitmClaimedMismatch(claimedBrands, registrable, data) {
  for (const name of claimedBrands) {
    const brand = data.brands.find((b) => b.name === name);
    if (brand && !brand.domains.includes(registrable)) return name;
  }
  return null;
}

// { host: count } → { registrable: count }. IP hosts pass through unchanged.
export function aitmReduceGraph(resourceHosts, data) {
  const graph = {};
  for (const host of Object.keys(resourceHosts ?? {})) {
    const key = aitmIsIp(host) ? host : registrableDomain(host, data.psl);
    graph[key] = (graph[key] ?? 0) + resourceHosts[host];
  }
  return graph;
}

// Reverse-proxy anomalies (0..2): (a) own-origin dominance; (b) every expected
// brand/IdP origin absent from the graph.
export function aitmResourceAnomalies(graph, claimedBrands, registrable, data) {
  const hosts = Object.keys(graph);
  const total = hosts.reduce((s, k) => s + graph[k], 0);
  let anomalies = 0;

  if (total >= AITM_GRAPH_MIN_RESOURCES && (graph[registrable] ?? 0) / total >= AITM_GRAPH_DOMINANCE) anomalies++;

  const expected = new Set();
  for (const name of claimedBrands) {
    const brand = data.brands.find((b) => b.name === name);
    if (brand) for (const d of brand.domains) expected.add(d);
  }
  if (data.aitmIdp) for (const d of data.aitmIdp) expected.add(d);
  if (expected.size && ![...expected].some((d) => graph[d] != null)) anomalies++;

  return anomalies;
}

// MAIN ENTRY — called by analyzer.js. ctx = { registrable, knownLegit, aitm }.
// Returns {score:0, reasons:[]} unless the full composite holds; corroborators
// are only ever appended on top of the primary.
export function runAitm(ctx, data) {
  const out = { score: 0, reasons: [] };
  const aitm = ctx.aitm;
  if (!aitm || !Array.isArray(aitm.interactions) || aitm.interactions.length === 0) return out;
  // Ultimate-trust classes never flag: known-legit, generic IdPs the attacker
  // can't own, and ZTNA/SWG/CASB wrappers that legitimately proxy other sites.
  if (ctx.knownLegit || data.aitmIdp?.has(ctx.registrable) || data.aitmMediation?.has(ctx.registrable)) return out;

  const claimed = aitmInferBrands(aitm.identityHints ?? {}, data);
  if (!claimed.length) return out;
  const mismatch = aitmClaimedMismatch(claimed, ctx.registrable, data);
  if (!mismatch) return out;

  out.score += AITM_PRIMARY_WEIGHT;
  out.reasons.push({ key: 'reasonAitmMismatch', params: [mismatch, ctx.registrable], weight: AITM_PRIMARY_WEIGHT });

  const graph = aitmReduceGraph(aitm.resourceHosts ?? {}, data);
  if (aitmResourceAnomalies(graph, claimed, ctx.registrable, data) >= AITM_GRAPH_MIN_ANOMALIES) {
    out.score += AITM_GRAPH_WEIGHT;
    out.reasons.push({ key: 'reasonAitmResourceGraph', params: [], weight: AITM_GRAPH_WEIGHT });
  }
  if (aitm.faviconCrossOrigin === true) {
    out.score += AITM_DRIFT_WEIGHT;
    out.reasons.push({ key: 'reasonAitmDrift', params: [], weight: AITM_DRIFT_WEIGHT });
  }
  return out;
}
