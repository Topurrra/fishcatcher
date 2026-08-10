// Link intelligence + download-type checks. Pure functions (no extension APIs),
// so they unit-test in Node and bundle into the background worker.
import { registrableDomain } from './psl.js';
import { isIpAddress } from './signals.js';
import { analyzeUrl } from './analyzer.js';

// Real file type is dangerous (a program) vs. looks like a harmless document.
export const DANGEROUS_EXT = new Set(['exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'msi', 'msix', 'msp', 'vbs', 'vbe', 'js', 'jse', 'jar', 'apk', 'dmg', 'app', 'ps1', 'sh', 'hta', 'wsf', 'wsh', 'reg', 'lnk', 'gadget', 'cpl', 'deb', 'rpm', 'iso']);
export const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'odt', 'ods', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'mp3', 'wav', 'mp4', 'mov', 'avi', 'zip', 'rar', '7z', 'tar', 'gz']);
const EXEC_MIME = /(x-msdownload|x-ms-installer|x-msi|x-dosexec|msdos-program|portable-executable|x-executable|x-elf|x-sh|x-shellscript|mach-o|x-apple-diskimage|vnd\.android\.package-archive|java-archive)/i;
const MIME_LABEL = [
  [/msdownload|dosexec|portable-executable|msdos-program/i, 'Windows program (.exe)'],
  [/x-msi|ms-installer/i, 'Windows installer (.msi)'],
  [/apple-diskimage/i, 'Mac disk image (.dmg)'],
  [/android\.package/i, 'Android app (.apk)'],
  [/java-archive/i, 'Java program (.jar)'],
  [/x-sh|shellscript|x-elf|x-executable|mach-o/i, 'program or script']
];

// Known URL shorteners: the real destination is hidden behind them.
const SHORTENERS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 't.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'bit.do', 'soo.gd', 'lnkd.in']);

export function fileExt(name) {
  const tail = String(name || '').split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop();
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(dot + 1).toLowerCase() : '';
}

export function registrableOf(input, psl) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return isIpAddress(host) ? host : registrableDomain(host, psl);
  } catch {
    return null;
  }
}

export function domainInText(text) {
  const m = String(text || '').match(/(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  return m ? m[1].toLowerCase().replace(/\.$/, '') : null;
}

// Each link = { href, text, download }. deep=true also engine-scores destinations.
// Returns [{ key, params, href }] ready for i18n.
export function classifyLinks(links, data, deep) {
  const findings = [];
  for (const l of links || []) {
    const destReg = registrableOf(l.href, data.psl);
    if (!destReg) continue;

    if (l.download) {
      const claimed = fileExt(l.download);
      let real = '';
      try { real = fileExt(new URL(l.href).pathname); } catch { /* ignore */ }
      if (claimed && real && claimed !== real && (DANGEROUS_EXT.has(real) || DANGEROUS_EXT.has(claimed))) {
        findings.push({ key: 'linkDownloadMismatch', params: [real.toUpperCase(), claimed.toUpperCase()], href: l.href });
        continue;
      }
    }

    if (SHORTENERS.has(destReg)) {
      findings.push({ key: 'linkShortener', params: [destReg], href: l.href });
      continue;
    }

    const shown = l.text && domainInText(l.text);
    if (shown) {
      const shownReg = registrableOf('http://' + shown, data.psl);
      if (shownReg && shownReg !== destReg && !data.safeList.has(destReg)) {
        findings.push({ key: 'linkTextMismatch', params: [shownReg, destReg], href: l.href });
        continue;
      }
    }

    if (deep && !data.safeList.has(destReg) && !data.trustList?.has(destReg)) {
      const r = analyzeUrl(l.href, data);
      if (r && (r.level === 'high' || r.level === 'critical')) {
        findings.push({ key: 'linkRisky', params: [destReg], href: l.href });
      }
    }
  }
  const seen = new Set();
  return findings.filter((f) => {
    const k = f.key + '|' + f.href;
    return seen.has(k) ? false : seen.add(k);
  }).slice(0, 50);
}

// A download named X but really something else. Returns { body, arg } for i18n, or null.
export function inspectDownload(name, mime) {
  const ext = fileExt(name);
  const parts = String(name || '').split('.');
  const inner = parts.length >= 3 ? parts[parts.length - 2].toLowerCase() : '';
  if (DANGEROUS_EXT.has(ext) && DOC_EXT.has(inner)) return { body: 'downloadMismatchBody', arg: ext.toUpperCase() + ' program' };
  if (DOC_EXT.has(ext) && EXEC_MIME.test(mime || '')) {
    const label = MIME_LABEL.find(([re]) => re.test(mime))?.[1] ?? 'program';
    return { body: 'downloadMismatchBody', arg: label };
  }
  if (DANGEROUS_EXT.has(ext)) return { body: 'downloadDangerousBody', arg: ext.toUpperCase() };
  return null;
}
