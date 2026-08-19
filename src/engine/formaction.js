// S20: form-action destination. Pure: probe-derived hostnames in, reasons out.
// A login form that posts somewhere other than the page's own site is the
// classic credential-harvest tell. Bundled into background.js by build.mjs;
// every top-level name is formAction-/FORM_ACTION-prefixed for the bundler.
import { registrableDomain } from './psl.js';
import { isIpAddress } from './signals.js';

export const FORM_ACTION_WEIGHT = 40;       // cross-domain post → high alone
export const FORM_ACTION_EXFIL_WEIGHT = 60; // known credential-exfil sink

// Hosts (and their subdomains) scammers use to collect what a victim types.
const FORM_ACTION_EXFIL_HOSTS = [
  'api.telegram.org', 'discord.com', 'discordapp.com', 'formspree.io', 'getform.io',
  'formsubmit.co', 'formcarry.com', 'docs.google.com', 'script.google.com',
  'webhook.site', 'pipedream.net', 'ngrok.io', 'ngrok-free.app', 'ngrok.app'
];

function formActionIsExfil(host) {
  if (isIpAddress(host)) return true;
  if (/(^|\.)requestbin\./.test(host)) return true;
  return FORM_ACTION_EXFIL_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}

// ctx = { registrable, knownLegit, aitm }; aitm.formActions = [hostname].
// Known-legit (top-100k) sites post to SSO hosts cross-domain routinely → silent.
export function runFormAction(ctx, data) {
  const out = { score: 0, reasons: [] };
  const hosts = ctx.aitm?.formActions;
  if (ctx.knownLegit || !Array.isArray(hosts) || !hosts.length) return out;
  let cross = null;
  for (const raw of hosts) {
    const host = String(raw).toLowerCase();
    const dest = isIpAddress(host) ? host : registrableDomain(host, data.psl);
    if (dest === ctx.registrable) continue;
    if (formActionIsExfil(host)) {
      out.score = FORM_ACTION_EXFIL_WEIGHT;
      out.reasons.push({ key: 'reasonFormExfil', params: [dest], weight: FORM_ACTION_EXFIL_WEIGHT });
      return out;
    }
    if (data.safeList?.has(dest) || data.aitmIdp?.has(dest) || data.aitmMediation?.has(dest)) continue;
    // Same-brand SSO (accounts.brand.com ↔ brand-mail.com) is not a mismatch.
    if (data.brands.some((b) => b.domains.includes(ctx.registrable) && b.domains.includes(dest))) continue;
    cross ??= dest;
  }
  if (cross) {
    out.score = FORM_ACTION_WEIGHT;
    out.reasons.push({ key: 'reasonFormAction', params: [cross], weight: FORM_ACTION_WEIGHT });
  }
  return out;
}
