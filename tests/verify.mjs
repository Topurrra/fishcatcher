// Invariant checks: manifests, locales, icons, dist output (M0) + engine corpus (M1).
// Run: node tests/verify.mjs (after node scripts/build.mjs)
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFirefoxManifest } from '../scripts/build.mjs';
import { analyzeUrl } from '../src/engine/analyzer.js';
import { punyDecode, decodeHost, asciiFold, hasMixedScripts } from '../src/engine/punycode.js';
import { registrableDomain } from '../src/engine/psl.js';
import { levenshtein } from '../src/engine/signals.js';
import { zipDirectory } from '../scripts/package.mjs';
import { matchDeviceCodeScam } from '../src/engine/devicecode.js';
import { Bloom } from '../src/engine/bloom.js';
import { parseRegistrationDate, ageInDays } from '../src/engine/rdap.js';
import { applyBundle } from '../src/engine/remote.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const data = {
  safeList: new Set(readJson('src/data/safe-list.json').domains),
  brands: readJson('src/data/brands.json').brands,
  tlds: readJson('src/data/tlds.json').tlds,
  keywords: readJson('src/data/keywords.json').keywords,
  psl: readJson('src/data/psl.json').suffixes,
  blockList: new Set(readJson('src/data/blocklist.json').domains),
  ml: readJson('src/data/ml-weights.json'),
  safeBloom: Bloom.fromPayload(readJson('src/data/safe-bloom.json')),
  aitmIdp: new Set(readJson('src/data/aitm-allow.json').idp),
  aitmMediation: new Set(readJson('src/data/aitm-allow.json').mediation)
};
const enMessages = readJson('src/_locales/en/messages.json');

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
  }
}

// ── M0: scaffold ────────────────────────────────────────────────
check('chrome manifest: MV3 basics', () => {
  const m = readJson('src/manifest.json');
  assert.equal(m.manifest_version, 3);
  assert.ok(m.background.service_worker, 'service_worker present');
  assert.ok(m.side_panel, 'side_panel present');
  assert.equal(m.default_locale, 'en');
  assert.match(m.name, /__MSG_/);
});

check('firefox transform: sidebar + event page', () => {
  const f = toFirefoxManifest(readJson('src/manifest.json'));
  assert.ok(f.sidebar_action, 'sidebar_action present');
  assert.deepEqual(f.background, { scripts: ['background.js'] });
  assert.equal(f.side_panel, undefined);
  assert.ok(!f.permissions.includes('sidePanel'));
  assert.equal(f.browser_specific_settings.gecko.id, 'fishcatcher@keepitlocal.app');
});

check('locales: en + ka with matching keys', () => {
  const en = readJson('src/_locales/en/messages.json');
  const ka = readJson('src/_locales/ka/messages.json');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ka).sort());
  for (const [key, entry] of Object.entries(en)) {
    assert.ok(entry.message?.trim(), `en.${key} has a message`);
    assert.ok(ka[key].message?.trim(), `ka.${key} has a message`);
  }
});

check('icons: all sizes are valid PNGs', () => {
  for (const size of [16, 32, 48, 128]) {
    const p = join(root, `src/icons/icon${size}.png`);
    assert.ok(existsSync(p), `icon${size}.png exists`);
    assert.equal(readFileSync(p).readUInt32BE(0), 0x89504e47, 'PNG magic');
  }
});

check('dist: built for both targets', () => {
  const chrome = readJson('dist/chrome/manifest.json');
  const firefox = readJson('dist/firefox/manifest.json');
  assert.ok(chrome.background.service_worker);
  assert.ok(firefox.sidebar_action, 'firefox dist has sidebar_action');
  assert.ok(existsSync(join(root, 'dist/chrome/popup/popup.html')));
  assert.ok(existsSync(join(root, 'dist/firefox/panel/panel.html')));
  // English only ships for now; ka stays in src (key parity is enforced above).
  assert.ok(existsSync(join(root, 'src/_locales/ka/messages.json')));
  assert.ok(!existsSync(join(root, 'dist/chrome/_locales/ka')));
  assert.ok(!existsSync(join(root, 'dist/firefox/_locales/ka')));
});

// ── M1: engine units ────────────────────────────────────────────
check('punycode: decodes IDN homoglyph host', () => {
  const decoded = decodeHost('xn--pypal-4ve.com');
  assert.notEqual(decoded, 'xn--pypal-4ve.com');
  assert.equal(asciiFold(decoded), 'paypal.com');
  assert.ok(hasMixedScripts(decoded), 'mixed Latin + Cyrillic detected');
});

check('psl: registrable domain extraction', () => {
  assert.equal(registrableDomain('login.microsoft.com.evil.ru', data.psl), 'evil.ru');
  assert.equal(registrableDomain('www.bbc.co.uk', data.psl), 'bbc.co.uk');
  assert.equal(registrableDomain('example.com', data.psl), 'example.com');
  assert.equal(registrableDomain('mygov.ge', data.psl), 'mygov.ge');
});

check('levenshtein: typo distance', () => {
  assert.equal(levenshtein('micr0soft.com', 'microsoft.com'), 1);
  assert.equal(levenshtein('paypa1.com', 'paypal.com'), 1);
  assert.equal(levenshtein('microsoft.com', 'microsoft.com'), 0);
});

// ── M1: phishing corpus (must be flagged) ───────────────────────
const phishing = [
  ['http://micr0soft.com/login', 'critical'],
  ['https://paypa1.com/', 'critical'],
  ['http://xn--pypal-4ve.com/', 'high'],
  ['https://login.microsoft.com.evil.ru/', 'high'],
  ['http://185.22.64.3/login', 'high'],
  ['https://paypal.com@evil.com/', 'elevated'],
  ['https://secure-verify-account.tk/', 'elevated'],
  ['https://a1b2c3.xyz/', 'high'],
  ['https://microsoft-login-2026.com/', 'critical'],
  ['https://dhl-track-parcel.top/', 'critical'],
  ['https://login.dhl-track-parcel.top/', 'critical']
];
for (const [url, level] of phishing) {
  check(`phishing: ${url} → ${level}`, () => {
    const r = analyzeUrl(url, data);
    assert.ok(r, 'analyzable');
    assert.equal(r.level, level, `score=${r.score} reasons=${r.reasons.map((x) => x.key)}`);
    assert.ok(r.reasons.length, 'has named reasons');
    for (const reason of r.reasons) {
      assert.ok(enMessages[reason.key], `locale has ${reason.key}`);
    }
  });
}

// ── M1: legit corpus (must stay quiet) ──────────────────────────
const legitZero = [
  'https://www.google.com/search?q=test',
  'https://github.com/qwen-code/qwen-code',
  'https://www.bbc.co.uk/',
  'https://login.microsoftonline.com/',
  'https://mygov.ge/',
  'https://www.tbcbank.ge/',
  'https://example.com/'
];
for (const url of legitZero) {
  check(`legit: ${url} → score 0`, () => {
    const r = analyzeUrl(url, data);
    assert.equal(r.score, 0, `reasons=${r.reasons.map((x) => x.key)}`);
    assert.equal(r.level, 'low');
  });
}

check('legit: http-only site stays low, not silent-fail', () => {
  const r = analyzeUrl('http://example.com/', data);
  assert.equal(r.level, 'low');
  assert.ok(r.score > 0 && r.score < 20);
});

check('engine: localhost / private LAN never flagged (dev + home network)', () => {
  for (const url of [
    'http://127.0.0.1/', 'http://127.0.0.1:3000/login', 'http://localhost:8080/',
    'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.16.4.9/', 'http://[::1]:5173/',
  ]) {
    const r = analyzeUrl(url, data);
    assert.equal(r.score, 0, `${url} reasons=${r.reasons.map((x) => x.key)}`);
    assert.equal(r.level, 'low');
  }
  // A real public IP is still flagged.
  assert.equal(analyzeUrl('http://185.22.64.3/login', data).level, 'high');
});

check('engine: non-http input ignored', () => {
  assert.equal(analyzeUrl('ftp://example.com/', data), null);
  assert.equal(analyzeUrl('not a url', data), null);
});

// ── M2: trust list + bundling + UI wiring ───────────────────────
check('engine: user trust short-circuits scoring', () => {
  const trusted = { ...data, trustList: new Set(['evil.ru']) };
  const r = analyzeUrl('https://login.microsoft.com.evil.ru/', trusted);
  assert.equal(r.score, 0);
  assert.equal(r.level, 'low');
});

check('bundle: background is a classic script in both targets', () => {
  for (const target of ['chrome', 'firefox']) {
    const src = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    assert.ok(src.includes('function analyzeUrl'), `${target}: engine bundled`);
    assert.ok(!/^import /m.test(src), `${target}: no import statements`);
    assert.ok(!/^export /m.test(src), `${target}: no export statements`);
  }
});

check('icons: per-level variants exist', () => {
  for (const size of [16, 32, 48, 128]) {
    for (const level of ['low', 'elevated', 'high', 'critical']) {
      assert.ok(existsSync(join(root, `src/icons/icon${size}-${level}.png`)), `icon${size}-${level}.png`);
    }
  }
});

check('locales: M2 popup strings present', () => {
  for (const key of ['levelLow', 'levelElevated', 'levelHigh', 'levelCritical', 'trustButton', 'untrustButton', 'recheckButton', 'reasonsTitle', 'noCheck']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── M3: strict mode, options, i18n override ─────────────────────
check('manifest: options page wired', () => {
  const m = readJson('src/manifest.json');
  assert.equal(m.options_ui.page, 'options/options.html');
  assert.ok(m.options_ui.open_in_tab);
});

check('bundle: i18n + banner bundled for both targets', () => {
  for (const target of ['chrome', 'firefox']) {
    const src = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    assert.ok(src.includes('function getMessage'), `${target}: i18n bundled`);
    // The strict-mode banner is rendered in the content script (no host perms needed).
    const probe = readFileSync(join(root, `dist/${target}/probe.js`), 'utf8');
    assert.ok(probe.includes('function showBanner'), `${target}: banner in content script`);
  }
});

check('locales: M3 options/banner strings present', () => {
  for (const key of ['optionsHeading', 'strictLabel', 'strictHint', 'remoteLabel', 'remoteUrlLabel', 'remoteHint', 'trustTitle', 'trustEmpty', 'removeTrust', 'bannerDismiss']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── M4: manifest hygiene + packaging ────────────────────────────
check('manifests: permissions match shipped features', () => {
  const c = readJson('src/manifest.json');
  const f = toFirefoxManifest(c);
  // contextMenus returned with the M5 right-click QR check
  assert.ok(c.permissions.includes('contextMenus'));
  assert.ok(f.permissions.includes('contextMenus'));
  assert.ok(!c.permissions.includes('webRequest'), 'no blocking APIs');
});

// ── M5: blocklist, probes, device-code, QR wiring ───────────────
check('engine: S13 password-form probe adds weight', () => {
  const r = analyzeUrl('https://random-unknown-site.com/', data, { hasPasswordForm: true });
  assert.equal(r.score, 20);
  assert.equal(r.level, 'elevated');
  assert.ok(r.reasons.some((x) => x.key === 'reasonPasswordForm'));
});

check('engine: S14 device-code text matcher', () => {
  assert.ok(matchDeviceCodeScam('To receive your prize, visit microsoft.com/link and enter the code shown below'));
  assert.ok(matchDeviceCodeScam('გაიარეთ ავტორიზაცია: devicelogin და შეიყვანეთ code'));
  assert.ok(!matchDeviceCodeScam('Documentation for microsoft.com/link API'));
  assert.ok(!matchDeviceCodeScam('Enter your verification code on your bank page'));
});

check('manifest: probe content script registered', () => {
  const m = readJson('src/manifest.json');
  assert.ok(m.content_scripts?.[0].js.includes('probe.js'));
  assert.ok(m.content_scripts[0].matches.includes('https://*/*'));
});

check('bundle: probe + background carry M5 code', () => {
  for (const target of ['chrome', 'firefox']) {
    const bg = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    assert.ok(bg.includes('jsQR'), `${target}: jsQR bundled`);
    const probe = readFileSync(join(root, `dist/${target}/probe.js`), 'utf8');
    assert.ok(probe.includes('function matchDeviceCodeScam'), `${target}: probe has matcher`);
    assert.ok(!/^import /m.test(probe) && !/^export /m.test(probe), `${target}: probe is classic`);
  }
});

check('license: MIT + vendor notice present', () => {
  assert.ok(existsSync(join(root, 'LICENSE')));
  assert.ok(existsSync(join(root, 'src/vendor/NOTICE.md')));
  assert.ok(existsSync(join(root, 'src/vendor/jsQR.js')));
});

check('locales: M5 strings present', () => {
  for (const key of ['reasonBlocklist', 'reasonPasswordForm', 'reasonDeviceCode', 'deviceCodeNotice', 'qrTitle', 'qrPick', 'qrCamera', 'qrStop', 'qrNone', 'qrResultNote', 'ctxCheckQr']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── M6: bloom, RDAP, remote v2, opt-in cloud ────────────────────
check('bloom: no false negatives, base64 round-trip', () => {
  const b = new Bloom(1024, 4, 7);
  for (const d of ['evil-one.com', 'evil-two.tk', 'bad.example']) b.add(d);
  assert.ok(b.has('evil-one.com'));
  assert.ok(b.has('evil-two.tk'));
  assert.ok(!b.has('google.com'));
  const restored = Bloom.fromPayload({ m: 1024, k: 4, seed: 7, bits: b.toBase64() });
  assert.ok(restored.has('bad.example'));
  assert.ok(!restored.has('github.com'));
});

check('bloom: no false negatives at scale (regression: signed-hash index bug)', () => {
  // The signed Math.imul bug made ~1% of items silently absent. Adding many
  // items and requiring every one back catches it (e.g. redhat.com missed).
  const b = new Bloom(200000, 10, 1);
  const items = ['redhat.com', 'google.ca', 'github.io', 'wikimedia.org'];
  for (let i = 0; i < 3000; i++) items.push(`site-${i}.example`);
  for (const it of items) b.add(it);
  for (const it of items) assert.ok(b.has(it), `${it} must be present`);
});

check('safe-bloom: allowlist suppresses brand FPs, keeps typosquats flagged', () => {
  // Known-legit brand-owned / near-collision domains must not be flagged...
  for (const d of ['google.ca', 'github.io', 'redhat.com', 'goo.gl']) {
    const r = analyzeUrl(`https://${d}/`, data);
    assert.ok(r.level === 'low' || r.level === 'elevated', `${d} should not be high/critical (was ${r.level})`);
  }
  // ...but a real typosquat not on the allowlist still fires.
  assert.equal(analyzeUrl('https://paypa1.com/', data).level, 'critical');
});

check('rdap: registration date parsing + age', () => {
  const rdap = { events: [ { eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }, { eventAction: 'registration', eventDate: '2026-08-01T00:00:00Z' } ] };
  const iso = parseRegistrationDate(rdap);
  assert.equal(iso, '2026-08-01T00:00:00Z');
  assert.equal(ageInDays(iso, Date.parse('2026-08-10T00:00:00Z')), 9);
  assert.equal(ageInDays('not-a-date'), null);
});

check('remote: v2 bundle applies bloom + lists', () => {
  const b = new Bloom(512, 3, 1);
  b.add('bloom-bad.com');
  const next = applyBundle(data, { blocklist: ['x-bad.com'], bloom: { m: 512, k: 3, seed: 1, bits: b.toBase64() } });
  assert.ok(next.blockList.has('x-bad.com'));
  assert.ok(next.bloom.has('bloom-bad.com'));
  assert.equal(next.trustList, data.trustList, 'trust list preserved');
  const r = analyzeUrl('https://bloom-bad.com/', next);
  assert.ok(r.reasons.some((x) => x.key === 'reasonBloom'));
});

check('engine: S15 young domain adds weight', () => {
  const r = analyzeUrl('https://random-unknown-site.com/', data, { youngDomainDays: 3 });
  assert.equal(r.score, 25);
  assert.ok(r.reasons.some((x) => x.key === 'reasonYoungDomain' && x.params[0] === '3'));
});

check('manifest: alarms + optional opt-in origins', () => {
  const m = readJson('src/manifest.json');
  assert.ok(m.permissions.includes('alarms'));
  // MV3: host patterns live in optional_host_permissions (Chrome ignores them in
  // optional_permissions, so permissions.request() would fail at enable time).
  assert.ok(m.optional_host_permissions.includes('https://rdap.org/*'));
  assert.ok(m.optional_host_permissions.includes('https://raw.githubusercontent.com/*'));
  assert.ok(m.optional_host_permissions.includes('https://safebrowsing.googleapis.com/*'));
  assert.ok(!m.optional_permissions.some((p) => p.includes('://')), 'no host patterns in optional_permissions');
});

check('locales: M6 strings present', () => {
  for (const key of ['reasonYoungDomain', 'reasonBloom', 'cloudLabel', 'cloudHint', 'remoteDefaultHint']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── M7: lexical model (S17) ─────────────────────────────────────
import { mlPredict } from '../src/engine/ml.js';

check('ml: random DGAs high, legit domains low', () => {
  const ml = data.ml;
  for (const d of ['xqzkvwqt', 'qwzxkjt9', 'a1b2c3']) assert.ok(mlPredict(ml, d) >= ml.threshold, `${d} flagged`);
  for (const d of ['google', 'example', 'microsoft', 'tbcbank', 'netgazeti']) assert.ok(mlPredict(ml, d) < ml.threshold, `${d} clean`);
});

check('engine: S17 fires on random domain only', () => {
  const flagged = analyzeUrl('https://xqzkvwqt.com/', data);
  assert.ok(flagged.reasons.some((x) => x.key === 'reasonMl'));
  const clean = analyzeUrl('https://example.com/', data);
  assert.ok(!clean.reasons.some((x) => x.key === 'reasonMl'));
});

check('bundle: ml inference bundled for both targets', () => {
  for (const target of ['chrome', 'firefox']) {
    const bg = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    assert.ok(bg.includes('function mlPredict'), `${target}: mlPredict bundled`);
  }
});

check('locales: reasonMl present', () => {
  assert.ok(enMessages.reasonMl);
});

// ── Link intelligence + download guard ──────────────────────────
import { classifyLinks, inspectDownload, fileExt } from '../src/engine/links.js';

check('links: text-vs-href mismatch flagged, honest links quiet', () => {
  const d = { ...data, trustList: new Set() };
  const bad = classifyLinks([{ href: 'https://evil.example/login', text: 'paypal.com', download: '' }], d, false);
  assert.equal(bad[0]?.key, 'linkTextMismatch');
  assert.deepEqual(bad[0].params, ['paypal.com', 'evil.example']);
  // text matches destination → no finding
  assert.equal(classifyLinks([{ href: 'https://github.com/a', text: 'github.com', download: '' }], d, false).length, 0);
  // www vs bare must NOT false-positive (same registrable)
  assert.equal(classifyLinks([{ href: 'https://www.github.com/', text: 'github.com', download: '' }], d, false).length, 0);
});

check('links: download-attribute extension disguise flagged', () => {
  const d = { ...data, trustList: new Set() };
  const f = classifyLinks([{ href: 'https://x.example/setup.exe', text: '', download: 'invoice.pdf' }], d, false);
  assert.equal(f[0]?.key, 'linkDownloadMismatch');
  assert.deepEqual(f[0].params, ['EXE', 'PDF']);
});

check('links: shortener destination flagged as hidden', () => {
  const d = { ...data, trustList: new Set() };
  const f = classifyLinks([{ href: 'https://bit.ly/abc', text: 'click here', download: '' }], d, false);
  assert.equal(f[0]?.key, 'linkShortener');
});

check('links: deep scan engine-scores destinations', () => {
  const d = { ...data, trustList: new Set() };
  const shallow = classifyLinks([{ href: 'https://paypa1.com/', text: '', download: '' }], d, false);
  assert.equal(shallow.length, 0, 'no cheap signal');
  const deep = classifyLinks([{ href: 'https://paypa1.com/', text: '', download: '' }], d, true);
  assert.ok(deep.some((x) => x.key === 'linkRisky'), 'engine catches the typosquat on deep scan');
});

check('download guard: disguise + double-extension + honest file', () => {
  assert.equal(inspectDownload('invoice.pdf', 'application/x-msdownload').body, 'downloadMismatchBody'); // pdf served as exe
  assert.equal(inspectDownload('photo.jpg.scr', 'application/octet-stream').body, 'downloadMismatchBody'); // double ext
  assert.equal(inspectDownload('setup.exe', 'application/x-msdownload').body, 'downloadDangerousBody'); // honest but dangerous
  assert.equal(inspectDownload('report.pdf', 'application/pdf'), null); // real pdf → quiet
  assert.equal(fileExt('a/b/c.TAR.GZ'), 'gz');
});

check('zip: valid store package (store method, EOCD intact)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-zip-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'b.json'), '{"x":1}');
    const zip = zipDirectory(dir);
    assert.equal(zip.readUInt32LE(0), 0x04034b50, 'local header magic');
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'EOCD magic');
    assert.equal(zip.readUInt16LE(zip.length - 12), 2, 'two entries');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── M8: AiTM (adversary-in-the-middle) ──────────────────────────
import { runAitm, aitmKindForText, aitmInferBrands } from '../src/engine/aitm.js';

// A Microsoft-branded credential page. identityHints stay login-proximate.
const msHints = { title: 'Sign in to your Microsoft account', ogSiteName: 'Microsoft', logoAlts: ['Microsoft'], brandTokens: ['password'] };
const aitmScan = (over = {}) => ({ interactions: ['password'], identityHints: msHints, resourceHosts: {}, faviconCrossOrigin: false, ...over });

check('aitm: aitmKindForText labels active identity controls', () => {
  assert.equal(aitmKindForText('Enter your password'), 'password');
  assert.equal(aitmKindForText('Sign in with a passkey'), 'passkey');
  assert.equal(aitmKindForText('Enter the verification code'), 'otp');
  assert.equal(aitmKindForText('Read our latest blog post'), null);
});

check('aitm: brand inference is login-proximate', () => {
  assert.deepEqual(aitmInferBrands(msHints, data), ['Microsoft']);
  // Empty hints infer nothing (conservative).
  assert.deepEqual(aitmInferBrands({ title: '', ogSiteName: '', logoAlts: [], brandTokens: [] }, data), []);
  // Federated login: a "Sign in with Microsoft" button (brandTokens) on a SaaS's
  // OWN page must NOT be read as the page claiming to be Microsoft.
  assert.deepEqual(aitmInferBrands({ title: 'Acme login', ogSiteName: 'Acme', logoAlts: ['Acme'], brandTokens: ['sign in with microsoft', 'password'] }, data), []);
});

check('aitm: composite fires reasonAitmMismatch [brand, registrable]', () => {
  const a = runAitm({ registrable: 'evil.ru', knownLegit: false, aitm: aitmScan() }, data);
  const primary = a.reasons.find((r) => r.key === 'reasonAitmMismatch');
  assert.ok(primary, 'primary fired');
  assert.deepEqual(primary.params, ['Microsoft', 'evil.ru']);
  assert.ok(a.score >= 45, `score ${a.score} reaches high`);
});

check('aitm: no interaction stays silent', () => {
  const a = runAitm({ registrable: 'evil.ru', knownLegit: false, aitm: aitmScan({ interactions: [] }) }, data);
  assert.equal(a.score, 0);
  assert.equal(a.reasons.length, 0);
  assert.deepEqual(runAitm({ registrable: 'evil.ru', knownLegit: false, aitm: null }, data), { score: 0, reasons: [] });
});

check('aitm: claim on the brand\'s own origin never flags', () => {
  // microsoft.com IS a Microsoft eTLD+1 → no origin mismatch → nothing fires.
  const a = runAitm({ registrable: 'microsoft.com', knownLegit: false, aitm: aitmScan() }, data);
  assert.equal(a.score, 0);
  assert.equal(a.reasons.length, 0);
});

check('aitm: knownLegit origin suppresses the composite', () => {
  const a = runAitm({ registrable: 'obscure-regional-login.example', knownLegit: true, aitm: aitmScan() }, data);
  assert.equal(a.score, 0);
  assert.equal(a.reasons.length, 0);
});

check('aitm: IdP + mediation allowlists are load-bearing (Okta/Zscaler FP guard)', () => {
  // okta.com and zscaler.net are NOT in any brand's .domains, so a Microsoft-
  // claiming page on them WOULD mismatch. Prove each allowlist is what suppresses
  // it: strip the allowlist and the same input must flag.
  const claim = aitmScan(); // claims Microsoft
  for (const [origin, key] of [['okta.com', 'aitmIdp'], ['zscaler.net', 'aitmMediation']]) {
    assert.ok(data[key].has(origin), `${origin} present in ${key}`);
    assert.equal(runAitm({ registrable: origin, knownLegit: false, aitm: claim }, data).score, 0, `${origin} suppressed`);
    const stripped = { ...data, [key]: new Set() };
    assert.ok(runAitm({ registrable: origin, knownLegit: false, aitm: claim }, stripped).score >= 45, `${origin} would flag without ${key}`);
  }
});

check('aitm: favicon drift adds a soft boost only on top of the primary', () => {
  const a = runAitm({ registrable: 'evil.ru', knownLegit: false, aitm: aitmScan({ faviconCrossOrigin: true }) }, data);
  const drift = a.reasons.find((r) => r.key === 'reasonAitmDrift');
  assert.ok(drift && drift.weight === 5, 'drift reason fires at weight 5');
  assert.equal(a.score, 60, '55 primary + 5 drift');
  // ...and never alone: drift without a claimed-brand mismatch scores nothing.
  const noBrand = { title: 'Welcome', ogSiteName: '', logoAlts: [], brandTokens: [] };
  assert.equal(runAitm({ registrable: 'x.example', knownLegit: false, aitm: { interactions: ['password'], identityHints: noBrand, resourceHosts: {}, faviconCrossOrigin: true } }, data).score, 0);
});

check('aitm: safe-listed origin short-circuits before any aitm signal', () => {
  // google.com is safe-listed → analyzeUrl returns score 0 at the top, even with
  // a Microsoft-claiming aitm payload that would otherwise reach high/critical.
  const r = analyzeUrl('https://google.com/', data, { aitm: aitmScan({ resourceHosts: { 'google.com': 8 }, faviconCrossOrigin: true }) });
  assert.equal(r.score, 0);
  assert.ok(!r.reasons.some((x) => x.key.startsWith('reasonAitm')), 'no aitm reason leaks past the short-circuit');
});

check('aitm: soft signals never fire without the primary (proxy alone = 0)', () => {
  // Collapsed resource graph + favicon drift but NO claimed brand → composite fails.
  const noBrand = { title: 'Welcome', ogSiteName: '', logoAlts: [], brandTokens: [] };
  const a = runAitm({ registrable: 'proxy-only.example', knownLegit: false, aitm: { interactions: ['password'], identityHints: noBrand, resourceHosts: { 'proxy-only.example': 8 }, faviconCrossOrigin: true } }, data);
  assert.equal(a.score, 0, 'a proxy existing alone scores nothing');
  assert.equal(a.reasons.length, 0);
});

check('aitm: resource-graph anomalies corroborate (+15), weight stays soft', () => {
  // All resources collapsed under evil.ru; Microsoft/IdP origins absent → 2 anomalies.
  const a = runAitm({ registrable: 'evil.ru', knownLegit: false, aitm: aitmScan({ resourceHosts: { 'cdn.evil.ru': 3, 'evil.ru': 4 } }) }, data);
  const graph = a.reasons.find((r) => r.key === 'reasonAitmResourceGraph');
  assert.ok(graph, 'resource-graph reason fired');
  assert.ok(graph.weight < 45, 'soft signal cannot reach high on its own');
  assert.equal(a.score, 70, `55 primary + 15 graph, got ${a.score}`);
});

check('aitm: analyzeUrl wires the composite to high/critical', () => {
  const r = analyzeUrl('https://evil.ru/login', data, { aitm: aitmScan({ resourceHosts: { 'evil.ru': 6 }, faviconCrossOrigin: true }) });
  assert.ok(r.reasons.some((x) => x.key === 'reasonAitmMismatch'));
  assert.ok(r.level === 'high' || r.level === 'critical', `level ${r.level} (score ${r.score})`);
  // No opts.aitm → legit/phishing corpora unchanged (no regression).
  assert.equal(analyzeUrl('https://example.com/', data).score, 0);
});

check('locales: M8 AiTM reason keys present', () => {
  for (const key of ['reasonAitmMismatch', 'reasonAitmResourceGraph', 'reasonAitmDrift']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── S18: Google Safe Browsing (opt-in) ──────────────────────────
import { gsbBody, gsbReasonKey } from '../src/engine/gsb.js';

check('gsb: request body targets the URL and the four threat types', () => {
  const b = gsbBody('https://evil.example/malware');
  assert.equal(b.threatInfo.threatEntries[0].url, 'https://evil.example/malware');
  assert.equal(b.threatInfo.threatEntryTypes[0], 'URL');
  for (const t of ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION']) {
    assert.ok(b.threatInfo.threatTypes.includes(t), `requests ${t}`);
  }
});

check('gsb: response maps to a reason key, clean → null', () => {
  assert.equal(gsbReasonKey({ matches: [{ threatType: 'SOCIAL_ENGINEERING' }] }), 'reasonGsbDeceptive');
  assert.equal(gsbReasonKey({ matches: [{ threatType: 'MALWARE' }] }), 'reasonGsbMalware');
  assert.equal(gsbReasonKey({ matches: [{ threatType: 'SOMETHING_NEW' }] }), 'reasonGsbUnsafe');
  assert.equal(gsbReasonKey({}), null);
  assert.equal(gsbReasonKey({ matches: [] }), null);
});

check('gsb: analyzeUrl adds the GSB verdict at high weight (and safe-list wins)', () => {
  const r = analyzeUrl('https://neutral-unknown-site.com/', data, { gsbThreat: 'reasonGsbMalware' });
  assert.ok(r.reasons.some((x) => x.key === 'reasonGsbMalware'));
  assert.ok(r.score >= 45, `GSB verdict reaches high (score ${r.score})`);
  // A safe-listed origin short-circuits before the GSB verdict is applied.
  const s = analyzeUrl('https://google.com/', data, { gsbThreat: 'reasonGsbMalware' });
  assert.equal(s.score, 0);
});

check('locales: S18 Google Safe Browsing keys present', () => {
  for (const key of ['reasonGsbDeceptive', 'reasonGsbMalware', 'reasonGsbUnwanted', 'reasonGsbHarmfulApp', 'reasonGsbUnsafe', 'gsbLabel', 'gsbHint', 'gsbKeyLabel', 'gsbActive']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── Scam packs: crypto seed + tech-support locker ────────────────
import { runScamPacks, scamCryptoSeedText, scamTechSupportText } from '../src/engine/scampacks.js';

check('scam: crypto seed matcher needs an action verb, not just the noun', () => {
  assert.ok(scamCryptoSeedText('Enter your 12-word seed phrase to restore your wallet.'));
  assert.ok(scamCryptoSeedText('Please confirm your recovery phrase to continue.'));
  assert.ok(scamCryptoSeedText('Paste your private key here to sync your wallet.'));
  // Educational / negated prose must stay quiet.
  assert.ok(!scamCryptoSeedText('Never share your recovery phrase with anyone.'));
  assert.ok(!scamCryptoSeedText('What is a seed phrase?'));
  assert.ok(!scamCryptoSeedText('We will never ask you to enter your seed phrase.'));
});

check('scam: tech-support matcher needs scare AND call-to-action together', () => {
  assert.ok(scamTechSupportText('Your computer has been locked due to suspicious activity. Call Microsoft support at 1-800-555-0100.'));
  assert.ok(scamTechSupportText('Windows Defender Alert: your PC is infected. Do not restart. Call our technicians now to remove the virus.'));
  assert.ok(scamTechSupportText('Critical alert: your system is blocked. Contact Apple support immediately at this toll-free number.'));
  // One half alone is not enough.
  assert.ok(!scamTechSupportText('Our office is closed. Call support during business hours.'));
  assert.ok(!scamTechSupportText('This article explains how ransomware locks your computer.'));
  assert.ok(!scamTechSupportText('Microsoft released a security update today.'));
});

check('scam: runScamPacks gating (seed OR seedInput; scare AND phone/fullscreen)', () => {
  assert.equal(runScamPacks({ scam: { cryptoSeed: true } }, data).score, 60);
  assert.equal(runScamPacks({ scam: { seedInput: true } }, data).score, 60);
  assert.equal(runScamPacks({ scam: { techScare: true, fullscreen: true } }, data).score, 55);
  assert.equal(runScamPacks({ scam: { techScare: true, phone: true } }, data).score, 55);
  // Scare without a corroborator (phone/fullscreen) must NOT fire.
  assert.equal(runScamPacks({ scam: { techScare: true } }, data).score, 0);
  // Null/undefined scam is a no-op.
  assert.deepEqual(runScamPacks({ scam: null }, data), { score: 0, reasons: [] });
  assert.deepEqual(runScamPacks({}, data), { score: 0, reasons: [] });
});

check('scam: analyzeUrl wires each pack to high (and no opts.scam = no regression)', () => {
  const crypto = analyzeUrl('https://neutral-unknown-site.com/', data, { scam: { cryptoSeed: true } });
  assert.ok(crypto.reasons.some((x) => x.key === 'reasonCryptoSeed'));
  assert.ok(crypto.level === 'high' || crypto.level === 'critical', `crypto level ${crypto.level} (score ${crypto.score})`);
  const tech = analyzeUrl('https://neutral-unknown-site.com/', data, { scam: { techScare: true, phone: true } });
  assert.ok(tech.reasons.some((x) => x.key === 'reasonTechSupport'));
  assert.ok(tech.level === 'high' || tech.level === 'critical', `tech level ${tech.level} (score ${tech.score})`);
  // No opts.scam → corpora unchanged.
  assert.equal(analyzeUrl('https://example.com/', data).score, 0);
});

check('locales: scam-pack reason keys present', () => {
  for (const key of ['reasonCryptoSeed', 'reasonTechSupport']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── store readiness: firefox data_collection_permissions, chrome min version, no WAR ──
check('store: firefox manifest declares data collection + min version 128', () => {
  const gecko = toFirefoxManifest(readJson('src/manifest.json')).browser_specific_settings.gecko;
  assert.deepEqual(gecko.data_collection_permissions.required, ['none']);
  assert.deepEqual(gecko.data_collection_permissions.optional, ['websiteActivity']);
  assert.equal(gecko.strict_min_version, '128.0');
});

check('store: chrome manifest has min version 116 and no web_accessible_resources', () => {
  const m = readJson('src/manifest.json');
  assert.equal(m.minimum_chrome_version, '116');
  assert.equal(m.web_accessible_resources, undefined);
});

check('store: only en locale ships; bundles use chrome.i18n, never fetch _locales', () => {
  assert.deepEqual(readdirSync(join(root, 'dist/chrome/_locales')), ['en']);
  for (const target of ['chrome', 'firefox']) {
    for (const file of ['background.js', 'probe.js']) {
      const src = readFileSync(join(root, `dist/${target}/${file}`), 'utf8');
      assert.ok(src.includes('chrome.i18n.getMessage'), `${target}/${file}: uses chrome.i18n`);
      assert.ok(!src.includes('_locales/'), `${target}/${file}: no _locales fetch`);
    }
  }
});

// ── worker: state recovery, alarm guard, QR fallback ──
check('worker: alarm guarded with alarms.get before create', () => {
  for (const target of ['chrome', 'firefox']) {
    const src = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    const get = src.search(/alarms\??\.get\('fc-list-update'/);
    const create = src.indexOf("alarms.create('fc-list-update'");
    assert.ok(get >= 0 && create > get, `${target}: alarms.get precedes alarms.create`);
    assert.ok(src.includes('REMOTE_REFRESH_MS'), `${target}: remote refresh constant`);
  }
});

check('worker: QR screenshot fallback + resend-facts in both bundles', () => {
  for (const target of ['chrome', 'firefox']) {
    const bg = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    const probe = readFileSync(join(root, `dist/${target}/probe.js`), 'utf8');
    assert.ok(bg.includes('captureVisibleTab'), `${target}: background uses captureVisibleTab`);
    assert.ok(bg.includes("'resend-facts'") && probe.includes("'resend-facts'"), `${target}: resend-facts wired`);
    assert.ok(bg.includes("'qr-image-rect'") && probe.includes("'qr-image-rect'"), `${target}: qr-image-rect wired`);
  }
});

check('locales: QR fallback notes in en + ka', () => {
  const ka = readJson('src/_locales/ka/messages.json');
  for (const key of ['qrUnreadable', 'qrNotUrl']) {
    assert.ok(enMessages[key]?.message, `en has ${key}`);
    assert.ok(ka[key]?.message, `ka has ${key}`);
  }
});

// ── engine: hosting suffixes, S8/S3/S13 fixes ──
check('psl: multi-tenant hosting suffixes make each tenant its own registrable', () => {
  assert.equal(registrableDomain('paypal-login.netlify.app', data.psl), 'paypal-login.netlify.app');
  assert.equal(registrableDomain('user.github.io', data.psl), 'user.github.io');
  assert.equal(registrableDomain('foo.web.app', data.psl), 'foo.web.app');
  assert.equal(registrableDomain('x.blob.core.windows.net', data.psl), 'x.blob.core.windows.net');
  // Longest suffix wins: s3.amazonaws.com over amazonaws.com.
  assert.equal(registrableDomain('bucket.s3.amazonaws.com', data.psl), 'bucket.s3.amazonaws.com');
  assert.equal(registrableDomain('cid.ipfs.dweb.link', data.psl), 'cid.ipfs.dweb.link');
  // The bare suffix host is still itself.
  assert.equal(registrableDomain('netlify.app', data.psl), 'netlify.app');
});

check('engine: Microsoft-branded password page on a netlify tenant is AiTM-flagged', () => {
  const aitm = { interactions: ['password'], identityHints: { title: 'Sign in to your Microsoft account', ogSiteName: '', logoAlts: ['Microsoft'] }, resourceHosts: { 'login-msft.netlify.app': 20 }, faviconCrossOrigin: false };
  const r = analyzeUrl('https://login-msft.netlify.app/', data, { aitm });
  assert.ok(r.level === 'high' || r.level === 'critical', `level=${r.level} score=${r.score}`);
  assert.ok(r.reasons.some((x) => x.key === 'reasonAitmMismatch'));
  // Brand-in-tenant-name phishing on hosting suffixes is no longer hidden by the host's bloom entry.
  for (const u of ['https://paypal-login.netlify.app/', 'https://microsoft-365-login.web.app/', 'https://office365-login.weebly.com/', 'https://login-microsoftonline.workers.dev/']) {
    const x = analyzeUrl(u, data);
    assert.ok(x.level === 'high' || x.level === 'critical', `${u} level=${x.level} score=${x.score}`);
  }
});

check('engine: S8 counts labels below the registrable domain only', () => {
  assert.ok(!analyzeUrl('https://www.google.co.uk/', data).reasons.some((x) => x.key === 'reasonSubdomains'));
  assert.ok(analyzeUrl('https://a.b.example.com/', data).reasons.some((x) => x.key === 'reasonSubdomains'));
  assert.ok(analyzeUrl('https://login.microsoft.com.evil.xyz/', data).reasons.some((x) => x.key === 'reasonSubdomains'));
});

check('engine: S3 folds digit homoglyphs, not legit digit domains', () => {
  const r = analyzeUrl('https://amaz0n-prime.ru/', data);
  assert.ok(r.reasons.some((x) => x.key === 'reasonBrandSubdomain'), `reasons=${r.reasons.map((x) => x.key)}`);
  for (const u of ['https://go4it.com/', 'https://1password.com/', 'https://win10.com/', 'https://freeb00k.com/']) {
    assert.ok(!analyzeUrl(u, data).reasons.some((x) => x.key === 'reasonBrandSubdomain'), u);
  }
  // The public suffix never counts as brand text: github.io / googleapis tenants stay clean.
  for (const u of ['https://user.github.io/', 'https://x.storage.googleapis.com/', 'https://raw.githubusercontent.com/']) {
    assert.ok(!analyzeUrl(u, data).reasons.some((x) => x.key === 'reasonBrandSubdomain'), u);
  }
});

check('engine: S13 weighs 20 on unknown domains, 10 on known-legit ones', () => {
  const unknown = analyzeUrl('https://random-unknown-site.com/', data, { hasPasswordForm: true });
  assert.equal(unknown.reasons.find((x) => x.key === 'reasonPasswordForm').weight, 20);
  assert.equal(unknown.level, 'elevated');
  const bank = analyzeUrl('https://chase.com/', data, { hasPasswordForm: true });
  assert.equal(bank.reasons.find((x) => x.key === 'reasonPasswordForm').weight, 10);
  assert.equal(bank.level, 'low');
});

check('engine: legit login pages and hosting tenants stay low', () => {
  for (const d of ['chase.com', 'bankofamerica.com', 'coinbase.com', 'github.com', 'accounts.google.com']) {
    const r = analyzeUrl(`https://${d}/`, data, { hasPasswordForm: true });
    assert.equal(r.level, 'low', `${d} score=${r.score} reasons=${r.reasons.map((x) => x.key)}`);
  }
  for (const d of ['myapp.netlify.app', 'user.github.io', 'foo.web.app']) {
    const r = analyzeUrl(`https://${d}/`, data);
    assert.equal(r.level, 'low', `${d} score=${r.score} reasons=${r.reasons.map((x) => x.key)}`);
  }
});

check('engine: S7 keyword is skipped on known-legit domains', () => {
  const legit = analyzeUrl('https://secure.wellsfargo.com/', data, { hasPasswordForm: true });
  assert.ok(!legit.reasons.some((r) => r.key === 'reasonKeyword'), 'no keyword reason on a known-legit host');
  assert.equal(legit.level, 'low');
  const phish = analyzeUrl('https://secure-login-update.com/', data);
  assert.ok(phish.reasons.some((r) => r.key === 'reasonKeyword'), 'keyword still fires on unknown hosts');
});

// ── report ──────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.error ? ` — ${c.error}` : ''}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
