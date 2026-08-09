// Stamps dist/chrome and dist/firefox from the shared src/ tree.
// src/manifest.json is the Chromium source of truth; the Firefox variant is derived.
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

export function toFirefoxManifest(m) {
  const f = structuredClone(m);
  delete f.side_panel;
  if (f.background?.service_worker) {
    f.background = { scripts: [f.background.service_worker] };
  }
  f.permissions = (f.permissions ?? []).filter((p) => p !== 'sidePanel');
  f.sidebar_action = {
    default_panel: 'panel/panel.html',
    default_title: '__MSG_appName__',
    open_at_install: false
  };
  f.browser_specific_settings = {
    gecko: { id: 'fishcatcher@keepitlocal.app', strict_min_version: '115.0' }
  };
  return f;
}

function main() {
  rmSync(dist, { recursive: true, force: true });
  for (const target of ['chrome', 'firefox']) {
    const out = join(dist, target);
    cpSync(src, out, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    const final = target === 'firefox' ? toFirefoxManifest(manifest) : manifest;
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(final, null, 2) + '\n');
    console.log(`built dist/${target}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
