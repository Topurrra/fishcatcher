// Registrable-domain (eTLD+1) extraction using the bundled Public Suffix List.
// Rules use PSL syntax: plain "co.uk", wildcard "*.ck", exception "!www.ck".
// Longest matching rule wins ("s3.amazonaws.com" beats "amazonaws.com"); an
// exception rule makes its own name the registrable domain; a host under an
// unlisted TLD falls back to the "*" rule, so the last two labels.

// Set view of the rules array, built once per array identity.
const ruleSets = new WeakMap();
function rulesOf(suffixes) {
  let set = ruleSets.get(suffixes);
  if (!set) {
    set = new Set(suffixes);
    ruleSets.set(suffixes, set);
  }
  return set;
}

export function registrableDomain(host, suffixes) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const rules = rulesOf(suffixes);
  // Candidate suffixes from longest to shortest; the first hit is the prevailing rule.
  for (let i = 0; i < labels.length; i++) {
    const cand = labels.slice(i).join('.');
    if (rules.has('!' + cand)) return cand;
    if (rules.has(cand) || (i + 1 < labels.length && rules.has('*.' + labels.slice(i + 1).join('.')))) {
      return i === 0 ? host : labels.slice(i - 1).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

// First label of the registrable domain ("evil" for evil.ru, "bbc" for bbc.co.uk).
export function sldOf(registrable) {
  return registrable.split('.')[0];
}
