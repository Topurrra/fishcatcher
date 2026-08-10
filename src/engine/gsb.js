// Google Safe Browsing v4 Lookup helper. Pure: builds the request body and maps
// a response to a fully-localized reason key. The network POST (and the user's
// API key) live in background.js checkGsb. Opt-in and disclosed: enabling it
// sends the address you visit to Google, using the user's own free API key.
// Docs: https://developers.google.com/safe-browsing/v4/lookup-api
export const GSB_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

const GSB_THREAT_REASON = {
  SOCIAL_ENGINEERING: 'reasonGsbDeceptive',
  MALWARE: 'reasonGsbMalware',
  UNWANTED_SOFTWARE: 'reasonGsbUnwanted',
  POTENTIALLY_HARMFUL_APPLICATION: 'reasonGsbHarmfulApp'
};

export function gsbBody(url) {
  return {
    client: { clientId: 'fishcatcher', clientVersion: '1' },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }]
    }
  };
}

// Response object -> reason key, or null when Safe Browsing returns no match.
export function gsbReasonKey(json) {
  const type = json?.matches?.[0]?.threatType;
  if (!type) return null;
  return GSB_THREAT_REASON[type] ?? 'reasonGsbUnsafe';
}
