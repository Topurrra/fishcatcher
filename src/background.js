// FishCatcher background worker (M5).
// Engine, i18n and jsQR are bundled into this file by scripts/build.mjs —
// this source file intentionally has no import/export statements.

const LEVEL_COLORS = { low: '#34d399', elevated: '#fbbf24', high: '#fb923c', critical: '#f87171', idle: '#6b7280' };
const BADGE_TEXT = { low: '', elevated: '!', high: '!!', critical: '!!!', idle: '' };

// One-click default update source — same pattern as voli-registry.
const DEFAULT_REMOTE_URL = 'https://raw.githubusercontent.com/topurrra/fishcatcher-registry/main/fishcatcher-lists.json';

const data = { safeList: new Set(), brands: [], tlds: {}, keywords: [], psl: [], blockList: new Set(), trustList: new Set(), bloom: null, aitmIdp: new Set(), aitmMediation: new Set() };
const results = new Map();
const probeFlags = new Map(); // tabId → page has a password form
const aitmFlags = new Map(); // tabId → raw aitm-scan payload (M8)
const scamFlags = new Map(); // tabId → scam-pack facts from the probe (crypto/tech-support)
const cloudFlags = new Map(); // tabId → young-domain age in days (opt-in RDAP)
const ageCache = new Map(); // registrable → age in days | null
const gsbFlags = new Map(); // tabId → Safe Browsing reason key (opt-in GSB)
const gsbCache = new Map(); // url → reason key | null
const dismissedBanners = new Set(); // `${tabId} ${url}`
const linkFindings = new Map(); // tabId → link-intelligence findings for the panel
const downloadWarnings = new Map(); // notificationId → downloadId (for the Cancel button)
const seniorNotifs = new Map(); // notificationId → mailto URL (family-mode "Tell my helper")
const seniorNotified = new Set(); // `${tabId} ${url}` already alerted in family mode
let pendingResult = null; // one-shot result handed to the panel (QR / link checks)
let pendingNote = null;
let cloudEnabled = false;
let gsbEnabled = false;
let gsbKey = '';
let seniorEnabled = false;
let seniorHelper = '';

async function loadData() {
  const [safe, brands, tlds, keywords, psl, block, mlw, safeBloom, allow, registryKey, stored] = await Promise.all([
    fetch(chrome.runtime.getURL('data/safe-list.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/brands.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/tlds.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/keywords.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/psl.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/blocklist.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/ml-weights.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/safe-bloom.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/aitm-allow.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/registry-key.json')).then((r) => r.json()),
    chrome.storage.local.get(['trust:list', 'opt:cloud', 'opt:gsb', 'gsb:key', 'opt:senior', 'senior:helper'])
  ]);
  data.safeList = new Set(safe.domains);
  data.safeBloom = Bloom.fromPayload(safeBloom);
  data.brands = brands.brands;
  data.tlds = tlds.tlds;
  data.keywords = keywords.keywords;
  data.psl = psl.suffixes;
  data.blockList = new Set(block.domains);
  data.aitmIdp = new Set(allow.idp);
  data.aitmMediation = new Set(allow.mediation);
  data.registryKey = registryKey;
  data.ml = mlw;
  data.trustList = new Set(stored['trust:list'] ? JSON.parse(stored['trust:list']) : []);
  cloudEnabled = !!stored['opt:cloud'];
  gsbEnabled = !!stored['opt:gsb'];
  gsbKey = stored['gsb:key'] || '';
  seniorEnabled = !!stored['opt:senior'];
  seniorHelper = stored['senior:helper'] || '';
  await loadRemoteLists();
}
const ready = loadData();

// Optional opt-in update channel: downloads a JSON bundle, never uploads anything.
// ETag-cached, refreshed daily via alarm. Falls back silently to bundled lists.
// Without `force` the network is skipped while the last fetch is under a day old
// (the worker restarts often; only the alarm and the opt-in toggle force a fetch).
// The last downloaded bundle is kept in storage.local and re-applied on every
// worker start, so the feed stays active across restarts and 304 responses.
const REMOTE_REFRESH_MS = 24 * 60 * 60 * 1000;
async function loadRemoteLists(force = false) {
  const prefs = await chrome.storage.local.get(['opt:remote', 'data:etag', 'remote:count', 'remote:updatedAt', 'remote:bundle']);
  if (!prefs['opt:remote']) return;
  if (prefs['remote:bundle'] && !data.bloom && await verifyBundle(prefs['remote:bundle'], data.registryKey)) {
    Object.assign(data, applyBundle(data, prefs['remote:bundle']));
  }
  if (!force && prefs['remote:updatedAt'] && Date.now() - prefs['remote:updatedAt'] < REMOTE_REFRESH_MS) {
    broadcast({ type: 'remote-status', state: 'ready', count: prefs['remote:count'], updatedAt: prefs['remote:updatedAt'] });
    return;
  }
  const url = DEFAULT_REMOTE_URL; // single fixed source: the FishCatcher registry
  broadcast({ type: 'remote-status', state: 'downloading' });
  try {
    const headers = {};
    // Use the cached ETag only once we have recorded a count; otherwise force a
    // full fetch so count and date get populated (self-heals older installs).
    if (prefs['data:etag'] && prefs['remote:count'] != null) headers['If-None-Match'] = prefs['data:etag'];
    const res = await fetch(url, { cache: 'no-store', headers });
    if (res.status === 304) {
      const s = await chrome.storage.local.get(['remote:count', 'remote:updatedAt']);
      broadcast({ type: 'remote-status', state: 'ready', count: s['remote:count'], updatedAt: s['remote:updatedAt'] });
      return;
    }
    if (!res.ok) {
      broadcast({ type: 'remote-status', state: 'error' });
      return;
    }
    const bundle = await res.json();
    // Signed by the registry's key (data/registry-key.json). An unsigned or
    // tampered file is refused and the bundled lists stay in force.
    if (!(await verifyBundle(bundle, data.registryKey))) {
      broadcast({ type: 'remote-status', state: 'error' });
      return;
    }
    Object.assign(data, applyBundle(data, bundle));
    const etag = res.headers.get('ETag');
    const count = typeof bundle.count === 'number' ? bundle.count : null;
    const updatedAt = Date.now();
    const set = { 'remote:updatedAt': updatedAt, 'remote:bundle': bundle };
    if (count != null) set['remote:count'] = count;
    if (etag) set['data:etag'] = etag;
    await chrome.storage.local.set(set);
    broadcast({ type: 'remote-status', state: 'ready', count, updatedAt });
  } catch {
    broadcast({ type: 'remote-status', state: 'error' }); // keep bundled lists
  }
}

// Create the alarm only if it does not exist: re-creating it on every worker
// start would restart its timer and it would never reach 24h.
chrome.alarms?.get('fc-list-update', (alarm) => {
  if (!alarm) chrome.alarms.create('fc-list-update', { periodInMinutes: 1440 });
});
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fc-list-update') loadRemoteLists(true);
});

// Opt-in RDAP domain-age check: sends only the registrable domain, nothing else.
async function checkAge(tabId, url, domain) {
  broadcast({ type: 'age-status', tabId, state: 'checking' });
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, { cache: 'no-store' });
    if (!res.ok) {
      ageCache.set(domain, null);
      return;
    }
    const age = ageInDays(parseRegistrationDate(await res.json()));
    ageCache.set(domain, age);
    if (age != null && age < YOUNG_DOMAIN_DAYS) {
      cloudFlags.set(tabId, age);
      scoreTab(tabId, url);
    }
  } catch {
    ageCache.set(domain, null);
  } finally {
    broadcast({ type: 'age-status', tabId, state: 'done' });
  }
}

// Opt-in Google Safe Browsing lookup. Sends the visited URL to Google using the
// user's own API key; result cached per URL. A bad key / quota / network error
// is treated as clean (fails open, never a false alarm).
async function checkGsb(tabId, url) {
  gsbCache.set(url, null); // mark in-flight so a re-score doesn't double-fetch
  try {
    const res = await fetch(`${GSB_ENDPOINT}?key=${encodeURIComponent(gsbKey)}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gsbBody(url))
    });
    if (!res.ok) return;
    const reasonKey = gsbReasonKey(await res.json());
    gsbCache.set(url, reasonKey);
    if (reasonKey) {
      gsbFlags.set(tabId, reasonKey);
      scoreTab(tabId, url);
    }
  } catch {
    // network error: leave cache null (clean)
  }
}

// Popup/panel may be closed — a broadcast with no receiver must not throw.
function broadcast(msg) {
  try {
    Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
  } catch {
    // ignore
  }
}

function iconPaths(level) {
  const paths = {};
  for (const size of [16, 32, 48, 128]) paths[size] = `icons/icon${size}-${level}.png`;
  return paths;
}

function paint(tabId, result) {
  const level = result?.level ?? 'idle';
  chrome.action.setIcon({ path: iconPaths(level), tabId });
  chrome.action.setBadgeText({ text: BADGE_TEXT[level], tabId });
  chrome.action.setBadgeBackgroundColor({ color: LEVEL_COLORS[level], tabId });
}

async function scoreTab(tabId, url) {
  await ready;
  const result = analyzeUrl(url, data, {
    hasPasswordForm: probeFlags.get(tabId) === true,
    youngDomainDays: cloudFlags.get(tabId) ?? null,
    aitm: aitmFlags.get(tabId) ?? null,
    scam: scamFlags.get(tabId) ?? null,
    gsbThreat: gsbFlags.get(tabId) ?? null
  });
  if (!result) {
    results.delete(tabId);
    paint(tabId, null);
    return;
  }
  result.trusted = data.trustList.has(result.registrable);
  result.realSite = realSiteFor(result.reasons, data.brands);
  results.set(tabId, result);
  paint(tabId, result);
  broadcast({ type: 'scored', tabId });
  maybeBanner(tabId, url, result);
  maybeSeniorNotify(tabId, url, result);
  if (cloudEnabled && !ageCache.has(result.registrable)) checkAge(tabId, url, result.registrable);
  if (gsbEnabled && gsbKey && !gsbCache.has(url) &&
      !data.safeList.has(result.registrable) && !data.trustList.has(result.registrable)) {
    checkGsb(tabId, url);
  }
}

// Strict mode (opt-in): informational, dismissible top banner on high/critical.
function bannerAllowed(tabId, url, result, strict) {
  return !!strict && !!result &&
    (result.level === 'high' || result.level === 'critical') &&
    !dismissedBanners.has(`${tabId} ${url}`);
}

async function bannerPayload(result) {
  return {
    level: result.level,
    domain: result.registrable,
    title: await getMessage(result.level === 'critical' ? 'levelCritical' : 'levelHigh'),
    reasons: await Promise.all(result.reasons.map((r) => getMessage(r.key, r.params.map(String)))),
    dismiss: await getMessage('bannerDismiss')
  };
}

async function maybeBanner(tabId, url, result) {
  const strict = (await chrome.storage.local.get('opt:strict'))['opt:strict'];
  if (!bannerAllowed(tabId, url, result, strict)) return;
  // Rendered by the content script (probe.js) so it works without host
  // permissions on automatic page loads, not just after a user gesture.
  chrome.tabs.sendMessage(tabId, { type: 'show-banner', payload: await bannerPayload(result) }).catch(() => {});
}

// Family mode: a prominent system notification on a dangerous page, so a warning
// is seen even when the panel is closed. Opt-in; uses the notifications
// permission (requested when family mode is enabled). Never blocks the page.
async function maybeSeniorNotify(tabId, url, result) {
  if (!seniorEnabled || !chrome.notifications?.create) return;
  if (result.level !== 'high' && result.level !== 'critical') return;
  const key = `${tabId} ${url}`;
  if (seniorNotified.has(key)) return;
  seniorNotified.add(key);

  const nid = `fc-senior-${tabId}-${Date.now()}`;
  const opts = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(`icons/icon48-${result.level}.png`),
    title: await getMessage('seniorNotifyTitle'),
    message: await getMessage('seniorNotifyBody', [result.registrable]),
    priority: 2,
    requireInteraction: true
  };
  if (seniorHelper) {
    const subject = await getMessage('seniorMailSubject');
    const body = await getMessage('seniorMailBody', [result.registrable]);
    seniorNotifs.set(nid, `mailto:${seniorHelper}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    opts.buttons = [{ title: await getMessage('seniorTellHelper') }];
  }
  chrome.notifications.create(nid, opts);
}

// S14 escalation: page text matches the device-code scam pattern.
async function flagDeviceCode(tabId, url) {
  await ready;
  const base = analyzeUrl(url, data) ?? { url, host: '', registrable: '', score: 0, level: 'low', reasons: [] };
  // Text alone never escalates a safe-listed, trusted or known-legitimate site:
  // those are docs and lessons that explain the scam, not the scam.
  if (data.safeList.has(base.registrable) || data.trustList.has(base.registrable) || data.safeBloom?.has(base.registrable)) return;
  const result = {
    ...base,
    score: 100,
    level: 'critical',
    reasons: [...base.reasons, { key: 'reasonDeviceCode', params: [], weight: 100 }]
  };
  result.trusted = false;
  results.set(tabId, result);
  paint(tabId, result);
  broadcast({ type: 'scored', tabId });
  maybeBanner(tabId, url, result);
}

// ── QR decoding (fully local) ───────────────────────────────────
// `crop` (optional) is a rect in bitmap pixels; it is clamped to the bitmap and
// a tiny visible part (< 40px either way) is treated as unreadable.
function decodeQrBitmap(bmp, crop) {
  let x = 0, y = 0, w = bmp.width, h = bmp.height;
  if (crop) {
    x = Math.max(0, Math.floor(crop.x));
    y = Math.max(0, Math.floor(crop.y));
    w = Math.min(bmp.width, Math.ceil(crop.x + crop.width)) - x;
    h = Math.min(bmp.height, Math.ceil(crop.y + crop.height)) - y;
    if (w < 40 || h < 40) return null;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx2d = canvas.getContext('2d');
  ctx2d.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const img = ctx2d.getImageData(0, 0, w, h);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

async function decodeQr(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    return decodeQrBitmap(bmp, null);
  } finally {
    bmp.close?.();
  }
}

// Fallback when the image itself cannot be fetched (no host permission for its
// origin): screenshot the visible tab (activeTab grants this after the
// context-menu click) and decode the image's on-screen rectangle, then the
// whole screenshot once.
async function decodeQrFromScreenshot(tab, srcUrl) {
  let rect = null, dpr = 1;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'qr-image-rect', srcUrl });
    rect = res?.rect ?? null;
    dpr = res?.dpr || 1;
  } catch {
    // content script not reachable: decode the full screenshot only
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const crop = rect ? { x: rect.x * dpr, y: rect.y * dpr, width: rect.width * dpr, height: rect.height * dpr } : null;
    return (crop && decodeQrBitmap(bmp, crop)) || decodeQrBitmap(bmp, null);
  } finally {
    bmp.close?.();
  }
}

async function openPanel(windowId) {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ windowId }).catch(() => {});
  } else if (chrome.sidebarAction) {
    chrome.sidebarAction.open().catch(() => {});
  }
}

async function checkQrImage(srcUrl, tab) {
  let text = null;
  try {
    text = await decodeQr(await (await fetch(srcUrl)).blob());
  } catch {
    // no host permission for the image origin, or not decodable: try a screenshot
  }
  if (!text && tab?.id != null) {
    try {
      text = await decodeQrFromScreenshot(tab, srcUrl);
    } catch {
      // capture not permitted or failed
    }
  }
  await ready;
  const result = text ? analyzeUrl(text, data) : null;
  if (result) {
    result.trusted = data.trustList.has(result.registrable);
    result.realSite = realSiteFor(result.reasons, data.brands);
  }
  pendingResult = result;
  // Never stay silent: the panel shows why there is no result.
  pendingNote = result ? 'qrResultNote' : text ? 'qrNotUrl' : 'qrUnreadable';
  // The panel was opened by the click handler (gesture intact); if it is already
  // showing, this tells it to pick up the result now.
  broadcast({ type: 'qr-pending' });
}

function createMenus() {
  getMessage('ctxCheckQr').then((title) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'check-qr', title, contexts: ['image'] });
    });
  });
}
chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'check-qr' && info.srcUrl) {
    // Open first, while the user gesture is still live: sidePanel.open() refuses
    // to run after the async fetch/screenshot work below.
    if (tab?.windowId) openPanel(tab.windowId);
    checkQrImage(info.srcUrl, tab);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // A new navigation invalidates the previous page's per-tab signals,
  // otherwise a password form (or young-domain age) on page A keeps
  // inflating the score of every later page in the same tab.
  if (changeInfo.status === 'loading') {
    probeFlags.delete(tabId);
    aitmFlags.delete(tabId);
    scamFlags.delete(tabId);
    cloudFlags.delete(tabId);
    gsbFlags.delete(tabId);
    linkFindings.delete(tabId);
    for (const k of seniorNotified) if (k.startsWith(`${tabId} `)) seniorNotified.delete(k);
  }
  if (changeInfo.status === 'complete' && tab.url) scoreTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab?.url) scoreTab(tabId, tab.url);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  results.delete(tabId);
  probeFlags.delete(tabId);
  aitmFlags.delete(tabId);
  scamFlags.delete(tabId);
  cloudFlags.delete(tabId);
  gsbFlags.delete(tabId);
  linkFindings.delete(tabId);
  for (const key of dismissedBanners) {
    if (key.startsWith(`${tabId} `)) dismissedBanners.delete(key);
  }
  for (const key of seniorNotified) {
    if (key.startsWith(`${tabId} `)) seniorNotified.delete(key);
  }
});

async function setTrust(domain, trusted) {
  await ready;
  if (trusted) data.trustList.add(domain);
  else data.trustList.delete(domain);
  await chrome.storage.local.set({ 'trust:list': JSON.stringify([...data.trustList]) });
  for (const [tabId, result] of [...results]) {
    if (result.registrable === domain) scoreTab(tabId, result.url);
  }
}

// Link intelligence + download-type logic live in engine/links.js (pure, tested).
async function storeLinks(tabId, links, deep) {
  await ready;
  const findings = classifyLinks(links, data, deep);
  linkFindings.set(tabId, findings);
  // A deep scan is answered directly to the caller; only broadcast the
  // automatic pass so an already-open panel refreshes without clobbering
  // a manual scan's on-screen summary.
  if (!deep) broadcast({ type: 'links', tabId });
  return findings;
}

// ── Download guard (opt-in; needs downloads + notifications permissions) ──
async function onDownloadCreated(item) {
  const s = await chrome.storage.local.get('opt:downloads');
  if (!s['opt:downloads']) return;
  const name = String(item.filename || item.finalUrl || item.url || '').split(/[\\/]/).pop().split(/[?#]/)[0];
  const finding = inspectDownload(name, item.mime);
  if (!finding || !chrome.notifications?.create) return;
  const nid = `fc-dl-${item.id}`;
  downloadWarnings.set(nid, item.id);
  chrome.notifications.create(nid, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48-critical.png'),
    title: await getMessage('downloadWarnTitle'),
    message: await getMessage(finding.body, [name, finding.arg]),
    buttons: [{ title: await getMessage('downloadCancel') }, { title: await getMessage('downloadKeep') }],
    priority: 2,
    requireInteraction: true
  });
}

function onNotifButton(nid, idx) {
  if (downloadWarnings.has(nid)) {
    const id = downloadWarnings.get(nid);
    if (id != null && idx === 0) chrome.downloads?.cancel(id).catch(() => {});
    downloadWarnings.delete(nid);
  } else if (seniorNotifs.has(nid)) {
    // "Tell my helper" — open the pre-filled email; the user still presses send.
    if (idx === 0) chrome.tabs.create({ url: seniorNotifs.get(nid) }).catch(() => {});
    seniorNotifs.delete(nid);
  }
  chrome.notifications?.clear(nid);
}

function setupDownloadGuard() {
  if (chrome.downloads?.onCreated && !chrome.downloads.onCreated.hasListener(onDownloadCreated)) {
    chrome.downloads.onCreated.addListener(onDownloadCreated);
  }
  if (chrome.notifications?.onButtonClicked && !chrome.notifications.onButtonClicked.hasListener(onNotifButton)) {
    chrome.notifications.onButtonClicked.addListener(onNotifButton);
  }
}
setupDownloadGuard();
chrome.permissions?.onAdded?.addListener(setupDownloadGuard);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    switch (msg.type) {
      case 'get-result':
        // Per-tab state is in-memory and lost when the worker is idle-killed,
        // while the tab icon keeps its colour. Rebuild the URL verdict now and
        // ask the page to resend its facts so the 'scored' broadcast re-renders.
        if (!results.has(msg.tabId) && msg.tabId != null) {
          try {
            const tab = await chrome.tabs.get(msg.tabId);
            if (tab?.url && /^https?:/i.test(tab.url)) {
              await scoreTab(msg.tabId, tab.url);
              chrome.tabs.sendMessage(msg.tabId, { type: 'resend-facts' }).catch(() => {});
            }
          } catch {
            // tab closed or not accessible
          }
        }
        sendResponse({ result: results.get(msg.tabId) ?? null });
        break;
      case 'rescore': {
        try {
          const tab = await chrome.tabs.get(msg.tabId);
          if (tab?.url) await scoreTab(msg.tabId, tab.url);
        } catch {
          // tab closed or not accessible — fall through to the last known result
        }
        sendResponse({ result: results.get(msg.tabId) ?? null });
        break;
      }
      case 'check-url': {
        const result = analyzeUrl(msg.url, data);
        if (result) {
          result.trusted = data.trustList.has(result.registrable);
          result.realSite = realSiteFor(result.reasons, data.brands);
        }
        sendResponse({ result });
        break;
      }
      case 'take-pending':
        sendResponse({ result: pendingResult, note: pendingNote });
        pendingResult = null;
        pendingNote = null;
        break;
      case 'aitm-scan':
        // Single M8 message; password rides inside it (replaces S13 form-probe).
        if (sender.tab) {
          aitmFlags.set(sender.tab.id, msg.payload);
          if (msg.payload?.interactions?.includes('password')) probeFlags.set(sender.tab.id, true);
          if (sender.tab.url) scoreTab(sender.tab.id, sender.tab.url);
        }
        sendResponse({ ok: true });
        break;
      case 'scam-scan':
        // Crypto seed-phrase / tech-support locker facts derived by the probe.
        if (sender.tab) {
          scamFlags.set(sender.tab.id, msg.scam);
          if (sender.tab.url) scoreTab(sender.tab.id, sender.tab.url);
        }
        sendResponse({ ok: true });
        break;
      case 'devicecode-scam':
        if (sender.tab?.url) flagDeviceCode(sender.tab.id, sender.tab.url);
        sendResponse({ ok: true });
        break;
      case 'trust':
        await setTrust(msg.domain, true);
        sendResponse({ ok: true });
        break;
      case 'untrust':
        await setTrust(msg.domain, false);
        sendResponse({ ok: true });
        break;
      case 'banner-dismissed':
        if (sender.tab) dismissedBanners.add(`${sender.tab.id} ${msg.url}`);
        sendResponse({ ok: true });
        break;
      case 'link-scan':
        if (sender.tab) await storeLinks(sender.tab.id, msg.links, false);
        sendResponse({ ok: true });
        break;
      case 'get-links':
        sendResponse({ findings: linkFindings.get(msg.tabId) ?? [] });
        break;
      case 'banner-check': {
        // The content script asks on load, avoiding the race where a pushed
        // banner arrives before the page's listener is ready.
        const bTab = sender.tab?.id;
        const bResult = bTab != null ? results.get(bTab) : null;
        const bStrict = (await chrome.storage.local.get('opt:strict'))['opt:strict'];
        sendResponse({ payload: bannerAllowed(bTab, sender.tab?.url, bResult, bStrict) ? await bannerPayload(bResult) : null });
        break;
      }
      case 'scan-links': {
        let links = null;
        try {
          links = (await chrome.tabs.sendMessage(msg.tabId, { type: 'collect-links' }))?.links ?? null;
        } catch {
          // content script not reachable (page not reloaded since an update, or a
          // restricted page). Keep whatever we already have rather than wiping it.
          links = null;
        }
        if (links == null) {
          sendResponse({ findings: linkFindings.get(msg.tabId) ?? [], scanned: null });
        } else {
          sendResponse({ findings: await storeLinks(msg.tabId, links, true), scanned: links.length });
        }
        break;
      }
    }
  })();
  return true; // respond asynchronously
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['opt:remote']) {
    if (changes['opt:remote'].newValue) {
      loadRemoteLists(true);
    } else {
      data.bloom = null; // back to the bundled lists, and forget the download
      chrome.storage.local.remove(['remote:bundle', 'data:etag', 'remote:count', 'remote:updatedAt']);
    }
  }
  if (changes['opt:cloud']) cloudEnabled = !!changes['opt:cloud'].newValue;
  if (changes['opt:gsb']) { gsbEnabled = !!changes['opt:gsb'].newValue; gsbCache.clear(); }
  if (changes['gsb:key']) { gsbKey = changes['gsb:key'].newValue || ''; gsbCache.clear(); }
  if (changes['opt:senior']) seniorEnabled = !!changes['opt:senior'].newValue;
  if (changes['senior:helper']) seniorHelper = changes['senior:helper'].newValue || '';
});

// Chromium-only: keyboard command opens the side panel.
// Firefox has no sidePanel API — its sidebar opens from the toolbar/view menu.
if (chrome.sidePanel) {
  // Chromium: clicking the toolbar icon opens the side panel (there is no popup
  // in the Chromium manifest). Firefox keeps its popup + sidebar_action instead.
  chrome.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === 'open_panel' && tab) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
}
