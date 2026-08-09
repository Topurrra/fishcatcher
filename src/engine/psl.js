// Registrable-domain (eTLD+1) extraction using a bundled Public Suffix List subset.
// Unknown multi-level suffixes fall back to the last label — acceptable for v1.

export function registrableDomain(host, suffixes) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  for (const suffix of suffixes) {
    const parts = suffix.split('.');
    if (labels.length <= parts.length) continue;
    const tail = labels.slice(-parts.length).join('.');
    if (tail === suffix) return labels.slice(-parts.length - 1).join('.');
  }
  return labels.slice(-2).join('.');
}

// First label of the registrable domain ("evil" for evil.ru, "bbc" for bbc.co.uk).
export function sldOf(registrable) {
  return registrable.split('.')[0];
}
