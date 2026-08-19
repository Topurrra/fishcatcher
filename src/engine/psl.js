// Registrable-domain (eTLD+1) extraction using a bundled Public Suffix List subset.
// Unknown multi-level suffixes fall back to the last label, acceptable for v1.
// The longest matching suffix wins, so "s3.amazonaws.com" beats "amazonaws.com".

export function registrableDomain(host, suffixes) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  let best = 1;
  for (const suffix of suffixes) {
    const parts = suffix.split('.');
    if (labels.length <= parts.length || parts.length <= best) continue;
    if (labels.slice(-parts.length).join('.') === suffix) best = parts.length;
  }
  return labels.slice(-best - 1).join('.');
}

// First label of the registrable domain ("evil" for evil.ru, "bbc" for bbc.co.uk).
export function sldOf(registrable) {
  return registrable.split('.')[0];
}
