// Device-code phishing text matcher (pure, unit-testable).
// Scam pages instruct victims to visit a legitimate device-login URL
// (microsoft.com/link, google.com/device, …) and type in a code shown on the
// scam page. The entry URL itself is clean — only the surrounding text gives
// the scam away.
export function matchDeviceCodeScam(text) {
  const t = text.toLowerCase();
  const mentionsEntry = /(microsoft\.com\/link|devicelogin|google\.com\/device|amazon\.com\/code)/.test(t);
  if (!mentionsEntry) return false;
  // "enter/type/use … code" in EN / KA / RU
  return /(enter|input|type|use|შეიყვან|введи|введите).{0,60}(code|კოდი|код)/.test(t);
}
