// Device-code phishing text matcher (pure, unit-testable).
// Scam pages instruct victims to visit a legitimate device-login URL
// (microsoft.com/link, google.com/device, ...) and type in a code shown on the
// scam page. The entry URL itself is clean; only the surrounding text gives the
// scam away. Three things must all be present, so pages that merely explain the
// trick (security lessons, docs) stay quiet:
//   1. a device-login entry URL,
//   2. an instruction to enter/type a code (EN / KA / RU),
//   3. an actual code next to the word "code": XXXX-XXXX or 8 to 9 capitals/digits
//      (Microsoft and Google device codes look like this).
// A page whose title says it is about phishing or scams is never flagged: lures do
// not call themselves phishing, lessons always do.
const ENTRY = /(microsoft\.com\/link|devicelogin|google\.com\/device|amazon\.com\/code)/;
const INSTRUCT = /(enter|input|type|use|შეიყვან|введи|введите).{0,60}(code|კოდი|код)/;
const CODE_NEAR = /code[^.\n]{0,40}\b([A-Z0-9]{4}-[A-Z0-9]{4,5}|[A-Z0-9]{8,9})\b|\b([A-Z0-9]{4}-[A-Z0-9]{4,5}|[A-Z0-9]{8,9})\b[^.\n]{0,40}code/;
const EDUCATIONAL_TITLE = /phish|scam|fraud|attack|security|how to spot|awareness/i;

export function matchDeviceCodeScam(text, title = '') {
  if (EDUCATIONAL_TITLE.test(title)) return false;
  const t = text.toLowerCase();
  if (!ENTRY.test(t) || !INSTRUCT.test(t)) return false;
  return CODE_NEAR.test(text);
}
