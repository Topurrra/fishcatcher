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

  // M8 AiTM probe: report DERIVED FACTS only (interactions, login-proximate
  // brand hints, resource hostnames) and let the worker+engine own the verdict.
  // Fires ONE message and only when an ACTIVE identity interaction is present,
  // so ordinary pages (and passkey-docs pages that merely MENTION the terms)
  // stay silent. Replaces the S13 form-probe: password now rides inside this as
  // an interaction kind, and the worker derives probeFlags from it.
  function collectAitm() {
    // aitmKindForText comes from the bundled engine/aitm.js; guard in case the
    // content bundle order isn't updated yet so the rest of the probe survives.
    const classify = typeof aitmKindForText === 'function' ? aitmKindForText : () => null;
    const visible = (el) => el.offsetParent !== null && !el.disabled && el.type !== 'hidden';
    const accText = (el) =>
      (el.getAttribute('aria-label') || el.value || el.textContent || el.getAttribute('placeholder') || '').trim();
    const hostOf = (url) => {
      try {
        const u = new URL(url, location.href);
        return /^https?:$/.test(u.protocol) ? u.hostname : null;
      } catch {
        return null;
      }
    };

    const kinds = new Set();

    // Password: structural, active input only.
    for (const inp of document.querySelectorAll('input[type="password"]')) {
      if (visible(inp)) { kinds.add('password'); break; }
    }

    // OTP: autocomplete=one-time-code is the strong structural tell; other short
    // numeric fields get text-classified.
    for (const inp of document.querySelectorAll(
      'input[autocomplete="one-time-code"], input[inputmode="numeric"][maxlength], input[name*="otp" i], input[id*="otp" i], input[name*="code" i][maxlength]'
    )) {
      if (!visible(inp)) continue;
      if (inp.getAttribute('autocomplete') === 'one-time-code') { kinds.add('otp'); continue; }
      const k = classify(accText(inp));
      if (k) kinds.add(k);
    }

    // passkey/ssoSetup/mfaApproval/mfaMigration/qrAuth/helpdeskUpgrade: classify
    // ACTIONABLE controls only (buttons, submits, form labels/legends/headings)
    // so prose mentions don't count as a flow.
    for (const el of document.querySelectorAll(
      'form button, input[type="submit"], [role="button"], form legend, form label, form h1, form h2, form h3'
    )) {
      if (!visible(el)) continue;
      const k = classify(accText(el));
      if (k) kinds.add(k);
    }

    // Device-code bridge: reuse the S14 matcher over the page body.
    const body = document.body?.innerText ?? '';
    if (body && body.length < 200000 && matchDeviceCodeScam(body)) kinds.add('deviceCode');

    if (!kinds.size) return null;

    // Login-proximate brand hints (never whole-body text).
    const title = (document.title || '').slice(0, 150);
    const ogSiteName = (
      document.querySelector('meta[property="og:site_name"], meta[name="og:site_name"]')?.content || ''
    ).slice(0, 80);
    const logoAlts = [];
    for (const img of document.querySelectorAll(
      'header img[alt], [class*="logo" i] img[alt], img[class*="logo" i][alt], img[id*="logo" i][alt]'
    )) {
      const alt = (img.getAttribute('alt') || '').trim().slice(0, 80);
      if (alt && !logoAlts.includes(alt)) logoAlts.push(alt);
      if (logoAlts.length >= 10) break;
    }
    const brandTokens = [];
    for (const el of document.querySelectorAll('form legend, form label, form h1, form h2, form h3')) {
      const t = (el.textContent || '').trim().toLowerCase().slice(0, 80);
      if (t && !brandTokens.includes(t)) brandTokens.push(t);
      if (brandTokens.length >= 40) break;
    }

    // Resource-origin graph: raw hostnames -> count (worker folds to eTLD+1).
    const resourceHosts = {};
    const addHost = (h) => {
      if (!h) return;
      if (resourceHosts[h] === undefined && Object.keys(resourceHosts).length >= 40) return;
      resourceHosts[h] = (resourceHosts[h] || 0) + 1;
    };
    for (const el of document.querySelectorAll('script[src], img[src], iframe[src]')) addHost(hostOf(el.src));
    for (const el of document.querySelectorAll('link[href]')) addHost(hostOf(el.href));
    for (const f of document.querySelectorAll('form[action]')) addHost(hostOf(f.action));
    try {
      for (const e of performance.getEntriesByType('resource')) addHost(hostOf(e.name));
    } catch {
      // performance API unavailable
    }

    // Favicon/manifest drift: served from a different host than the page.
    let faviconCrossOrigin = false;
    for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="manifest"]')) {
      const h = hostOf(l.href);
      if (h && h !== location.hostname) { faviconCrossOrigin = true; break; }
    }

    return {
      interactions: [...kinds],
      identityHints: { title, ogSiteName, logoAlts, brandTokens },
      resourceHosts,
      faviconCrossOrigin
    };
  }

  const aitm = collectAitm();
  if (aitm) send({ type: 'aitm-scan', payload: aitm });

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

  // Ask whether a strict-mode banner is due now that our listener is ready.
  try {
    Promise.resolve(chrome.runtime.sendMessage({ type: 'banner-check' }))
      .then((res) => { if (res?.payload) showBanner(res.payload); })
      .catch(() => {});
  } catch {
    // extension context not available
  }

  chrome.runtime.onMessage.addListener((m, _sender, respond) => {
    if (m.type === 'collect-links') {
      respond({ links: collectLinks(true) });
      return true;
    }
    if (m.type === 'show-banner') {
      showBanner(m.payload);
    }
  });

  // Strict-mode warning banner (payload strings pre-resolved by the worker).
  function showBanner(payload) {
    if (document.getElementById('fishcatcher-banner')) return;
    const colors = { high: '#fb923c', critical: '#f87171' };
    const root = document.createElement('div');
    root.id = 'fishcatcher-banner';
    root.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1c1c1c;color:#f2f2f2;border-bottom:2px solid ${colors[payload.level]};font:13px/1.5 system-ui,sans-serif;padding:10px 14px;display:flex;gap:12px;align-items:flex-start;`;
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;min-width:0';
    const title = document.createElement('strong');
    title.textContent = `FishCatcher: ${payload.title}`;
    main.appendChild(title);
    const domain = document.createElement('div');
    domain.style.cssText = 'color:#5eead4;font-family:monospace;font-size:12px';
    domain.textContent = payload.domain;
    main.appendChild(domain);
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:6px 0 0;padding:0 0 0 18px;list-style:disc';
    for (const text of payload.reasons) {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    }
    main.appendChild(ul);
    const btn = document.createElement('button');
    btn.textContent = payload.dismiss;
    btn.style.cssText = 'background:#2a2a2a;color:#f2f2f2;border:1px solid #444;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit';
    btn.addEventListener('click', () => {
      root.remove();
      send({ type: 'banner-dismissed', url: location.href });
    });
    root.appendChild(main);
    root.appendChild(btn);
    document.documentElement.appendChild(root);
  }

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
