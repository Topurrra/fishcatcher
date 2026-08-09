// Invariant checks: manifests, locales, icons, dist output (M0) + engine corpus (M1).
// Run: node tests/verify.mjs (after node scripts/build.mjs)
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFirefoxManifest } from '../scripts/build.mjs';
import { analyzeUrl } from '../src/engine/analyzer.js';
import { punyDecode, decodeHost, asciiFold, hasMixedScripts } from '../src/engine/punycode.js';
import { registrableDomain } from '../src/engine/psl.js';
import { levenshtein } from '../src/engine/signals.js';
import { format } from '../src/ui/i18n.js';
import { zipDirectory } from '../scripts/package.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const data = {
  safeList: new Set(readJson('src/data/safe-list.json').domains),
  brands: readJson('src/data/brands.json').brands,
  tlds: readJson('src/data/tlds.json').tlds,
  keywords: readJson('src/data/keywords.json').keywords,
  psl: readJson('src/data/psl.json').suffixes
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
  assert.ok(existsSync(join(root, 'dist/firefox/_locales/ka/messages.json')));
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
  ['http://micr0soft.com/login', 'high'],
  ['https://paypa1.com/', 'high'],
  ['http://xn--pypal-4ve.com/', 'high'],
  ['https://login.microsoft.com.evil.ru/', 'high'],
  ['http://185.22.64.3/login', 'high'],
  ['https://paypal.com@evil.com/', 'elevated'],
  ['https://secure-verify-account.tk/', 'elevated'],
  ['https://a1b2c3.xyz/', 'elevated'],
  ['https://microsoft-login-2026.com/', 'high']
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
check('i18n: $N substitution', () => {
  assert.equal(format('Mentions $1 but is not a $1 domain', ['Microsoft']), 'Mentions Microsoft but is not a Microsoft domain');
  assert.equal(format('No $1 here', []), 'No  here');
});

check('manifest: options page wired', () => {
  const m = readJson('src/manifest.json');
  assert.equal(m.options_ui.page, 'options/options.html');
  assert.ok(m.options_ui.open_in_tab);
});

check('bundle: i18n + banner bundled for both targets', () => {
  for (const target of ['chrome', 'firefox']) {
    const src = readFileSync(join(root, `dist/${target}/background.js`), 'utf8');
    assert.ok(src.includes('function getMessage'), `${target}: i18n bundled`);
    assert.ok(src.includes('function showBanner'), `${target}: banner bundled`);
  }
});

check('locales: M3 options/banner strings present', () => {
  for (const key of ['optionsHeading', 'strictLabel', 'strictHint', 'remoteLabel', 'remoteUrlLabel', 'remoteHint', 'langLabel', 'langAuto', 'trustTitle', 'trustEmpty', 'removeTrust', 'bannerDismiss']) {
    assert.ok(enMessages[key], `en has ${key}`);
  }
});

// ── M4: manifest hygiene + packaging ────────────────────────────
check('manifests: no unused contextMenus permission', () => {
  const c = readJson('src/manifest.json');
  const f = toFirefoxManifest(c);
  assert.ok(!c.permissions.includes('contextMenus'));
  assert.ok(!f.permissions.includes('contextMenus'));
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

// ── report ──────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.error ? ` — ${c.error}` : ''}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
