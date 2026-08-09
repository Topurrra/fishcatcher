// RDAP (RFC 9083) helpers for the opt-in domain-age cloud check.
export function parseRegistrationDate(rdap) {
  const ev = rdap?.events?.find((e) => e.eventAction === 'registration');
  return ev?.eventDate ?? null;
}

export function ageInDays(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

export const YOUNG_DOMAIN_DAYS = 30;
