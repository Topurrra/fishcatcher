// FishCatcher page probe (content script).
// Bundled at build time with engine/devicecode.js + ui/i18n.js — no imports here.
(function () {
  const send = (msg) => {
    try {
      Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
    } catch {
      // ignore
    }
  };

  // S13 probe: does the page contain a password form?
  if (document.querySelector('input[type="password"]')) {
    send({ type: 'form-probe' });
  }

  // Link intelligence: collect anchors and let the background (which has the
  // full engine + PSL) judge them. The auto pass sends only candidates worth
  // checking; the panel's "Scan links" button asks for the full set.
  function collectLinks(all) {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href;
      if (!/^https?:/i.test(href)) continue;
      const download = a.getAttribute('download') || '';
      const text = (a.textContent || '').trim().slice(0, 120);
      if (!all && !download && !/[a-z0-9-]+\.[a-z]{2,}/i.test(text)) continue;
      const key = href + '|' + download;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ href, text, download });
      if (out.length >= (all ? 800 : 100)) break;
    }
    return out;
  }

  const linkCandidates = collectLinks(false);
  if (linkCandidates.length) send({ type: 'link-scan', links: linkCandidates });

  chrome.runtime.onMessage.addListener((m, _sender, respond) => {
    if (m.type === 'collect-links') {
      respond({ links: collectLinks(true) });
      return true;
    }
  });

  // S14 probe (strict mode only): device-code scam text on the page.
  chrome.storage.local.get('opt:strict', (stored) => {
    if (!stored['opt:strict']) return;
    const text = document.body?.innerText ?? '';
    if (text && text.length < 200000 && matchDeviceCodeScam(text)) {
      send({ type: 'devicecode-scam' });
    }
  });

  // Educational notice on legitimate device-code entry pages.
  const host = location.hostname.replace(/^www\./, '');
  const isDevicePage =
    ((host === 'microsoft.com' || host.endsWith('.microsoft.com')) && location.pathname.startsWith('/link')) ||
    ((host === 'google.com' || host.endsWith('.google.com')) && location.pathname.startsWith('/device'));

  if (isDevicePage) {
    (async () => {
      if (document.getElementById('fishcatcher-devicecode')) return;
      const text = await getMessage('deviceCodeNotice');
      const dismiss = await getMessage('bannerDismiss');
      const root = document.createElement('div');
      root.id = 'fishcatcher-devicecode';
      root.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:340px;background:#1c1c1c;color:#f2f2f2;border:1px solid #2dd4bf;border-radius:10px;font:13px/1.5 system-ui,sans-serif;padding:10px 12px;';
      const p = document.createElement('p');
      p.style.cssText = 'margin:0 0 8px';
      p.textContent = text;
      const btn = document.createElement('button');
      btn.textContent = dismiss;
      btn.style.cssText = 'background:#2a2a2a;color:#f2f2f2;border:1px solid #444;border-radius:6px;padding:3px 10px;cursor:pointer;font:inherit';
      btn.addEventListener('click', () => root.remove());
      root.append(p, btn);
      document.documentElement.appendChild(root);
    })();
  }
})();
