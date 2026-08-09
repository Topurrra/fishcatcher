// M0 invariant checks: manifests, locales, icons, dist output.
// Run: node tests/verify.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFirefoxManifest } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
  }
}

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
    const buf = readFileSync(p);
    assert.equal(buf.readUInt32BE(0), 0x89504e47, 'PNG magic');
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

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.error ? ` — ${c.error}` : ''}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
