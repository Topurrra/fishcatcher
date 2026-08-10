// Scam packs — crypto/wallet drainers + tech-support / browser-locker scares.
// Pure: text/DOM-derived facts in, reasons out. No chrome/DOM APIs. Bundled into
// background.js AND probe.js by build.mjs, so every top-level name is scam-prefixed
// for the bundler's uniqueness rule.
//
// Both matchers are TWO-PART on purpose (near-zero false positives): the crypto
// matcher needs an ACTION VERB next to the seed/key NOUN (educational prose like
// "never share your recovery phrase" carries the noun but no imperative), and the
// tech matcher needs a SCARE phrase AND a call-to-action together.

// Calibration knobs — exported so tests pin behaviour and tuning is one line.
export const SCAM_CRYPTO_WEIGHT = 60; // seed-phrase request → 'high' alone
export const SCAM_TECH_WEIGHT = 55;   // support-scare + phone/fullscreen → 'high' alone

// Imperative verb close to a wallet-secret noun, same sentence ([^.!?\n]). Global
// so scamCryptoSeedText can walk every hit and drop negated ones.
const SCAM_SEED_RE =
  /(enter|input|type|paste|import|confirm|validate|verify|provide|re-?enter)[^.!?\n]{0,30}(secret recovery phrase|seed phrase|seed words|recovery phrase|secret phrase|mnemonic( phrase)?|private key)/g;
// Cheap negation guard: kills legit warnings like "we will never ask you to enter
// your seed phrase" that legitimate wallets show.
const SCAM_SEED_NEG = /\b(never|not|avoid|nobody|no one|don'?t|won'?t|can'?t|will not|should not|shouldn'?t)\b/;

export function scamCryptoSeedText(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  SCAM_SEED_RE.lastIndex = 0;
  let m;
  while ((m = SCAM_SEED_RE.exec(t))) {
    // ponytail: 24-char lookback for a negation; widen only if FPs surface.
    if (!SCAM_SEED_NEG.test(t.slice(Math.max(0, m.index - 24), m.index))) return true;
  }
  return false;
}

// Browser-locker / fake-support scare (part 1). EN + cheap KA/RU stems.
const SCAM_TECH_SCARE =
  /(your |this )?(computer|pc|laptop|windows|mac|device|system)\b[^.!?\n]{0,40}\b(infected|locked|blocked|compromised|hacked|disabled|suspended|at risk)\b|(virus|trojan|spyware|malware|ransomware)[^.!?\n]{0,20}\b(detected|found|infection)\b|security (alert|warning|breach)|suspicious (sign[\s-]?in|activity|login)|windows defender|do ?n'?t (restart|close|shut|turn off|power off)|do not (restart|close|shut|turn off|power off)|ვირუს|კომპიუტერი (დაბლოკ|ვირუს)|заблокирован|заражен|вирус/;
// Support / call-to-action (part 2): call/contact/dial near support/brand/number,
// or a toll-free number. EN + cheap KA/RU stems.
const SCAM_TECH_CTA =
  /\bcall\b[^.!?\n]{0,30}\b(support|technician|help ?line|number|toll|microsoft|apple|windows|now|immediately)\b|\b(contact|dial|phone)\b[^.!?\n]{0,25}\b(support|technician|help ?line|number|toll|microsoft|apple)\b|toll[\s-]?free|\b1[\s.\-]?\(?8(00|88|77|66|55|44|33)\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b|დარეკ|позвони/;

export function scamTechSupportText(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return SCAM_TECH_SCARE.test(t) && SCAM_TECH_CTA.test(t);
}

// MAIN ENTRY — called by analyzer.js. ctx = { scam, knownLegit }. scam holds the
// booleans the probe derives: { cryptoSeed, seedInput, techScare, phone, fullscreen }.
// knownLegit is passed for possible future use; safeList/trustList already short-
// circuit earlier in analyzer.js so we don't re-check it here.
export function runScamPacks(ctx, data) {
  const out = { score: 0, reasons: [] };
  const scam = ctx && ctx.scam;
  if (!scam) return out;

  if (scam.cryptoSeed || scam.seedInput) {
    out.score += SCAM_CRYPTO_WEIGHT;
    out.reasons.push({ key: 'reasonCryptoSeed', params: [], weight: SCAM_CRYPTO_WEIGHT });
  }
  if (scam.techScare && (scam.phone || scam.fullscreen)) {
    out.score += SCAM_TECH_WEIGHT;
    out.reasons.push({ key: 'reasonTechSupport', params: [], weight: SCAM_TECH_WEIGHT });
  }
  return out;
}
