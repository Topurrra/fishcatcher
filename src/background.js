// FishCatcher background worker (M3).
// Engine + i18n functions are bundled into this file by scripts/build.mjs —
// this source file intentionally has no import/export statements.

const LEVEL_COLORS = { low: '#34d399', elevated: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const BADGE_TEXT = { low: '', elevated: '!', high: '!!', critical: '!!!' };

const data = { safeList: new Set(), brands: [], tlds: {}, keywords: [], psl: [], trustList: new Set() };
const results = new Map();
const dismissedBanners = new Set(); // `${tabId} ${url}`

async function loadData() {
  const [safe, brands, tlds, keywords, psl, stored] = await Promise.all([
    fetch(chrome.runtime.getURL('data/safe-list.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/brands.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/tlds.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/keywords.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/psl.json')).then((r) => r.json()),
    chrome.storage.local.get('trust:list')
  ]);
  data.safeList = new Set(safe.domains);
  data.brands = brands.brands;
  data.tlds = tlds.tlds;
  data.keywords = keywords.keywords;
  data.psl = psl.suffixes;
  data.trustList = new Set(stored['trust:list'] ? JSON.parse(stored['trust:list']) : []);
  await loadRemoteLists();
}
const ready = loadData();

// Optional opt-in update channel: downloads a JSON bundle, never uploads anything.
// Falls back silently to the bundled lists on any failure.
async function loadRemoteLists() {
  const prefs = await chrome.storage.local.get(['opt:remote', 'opt:remoteUrl']);
  if (!prefs['opt:remote'] || !prefs['opt:remoteUrl']) return;
  try {
    const res = await fetch(prefs['opt:remoteUrl'], { cache: 'no-store' });
    if (!res.ok) return;
    const bundle = await res.json();
    if (Array.isArray(bundle.domains)) data.safeList = new Set(bundle.domains);
    if (Array.isArray(bundle.brands)) data.brands = bundle.brands;
    if (bundle.tlds && typeof bundle.tlds === 'object') data.tlds = bundle.tlds;
    if (Array.isArray(bundle.keywords)) data.keywords = bundle.keywords;
  } catch {
    // keep bundled lists
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
  const level = result?.level ?? 'low';
  chrome.action.setIcon({ path: iconPaths(level), tabId });
  chrome.action.setBadgeText({ text: BADGE_TEXT[level], tabId });
  chrome.action.setBadgeBackgroundColor({ color: LEVEL_COLORS[level], tabId });
}

async function scoreTab(tabId, url) {
  await ready;
  const result = analyzeUrl(url, data);
  if (!result) {
    results.delete(tabId);
    paint(tabId, null);
    return;
  }
  result.trusted = data.trustList.has(result.registrable);
  results.set(tabId, result);
  paint(tabId, result);
  broadcast({ type: 'scored', tabId });
  maybeBanner(tabId, url, result);
}

// Strict mode (opt-in): informational, dismissible top banner on high/critical.
async function maybeBanner(tabId, url, result) {
  const strict = (await chrome.storage.local.get('opt:strict'))['opt:strict'];
  if (!strict || (result.level !== 'high' && result.level !== 'critical')) return;
  if (dismissedBanners.has(`${tabId} ${url}`)) return;
  const payload = {
    level: result.level,
    domain: result.registrable,
    title: await getMessage(result.level === 'critical' ? 'levelCritical' : 'levelHigh'),
    reasons: await Promise.all(result.reasons.map((r) => getMessage(r.key, r.params.map(String)))),
    dismiss: await getMessage('bannerDismiss')
  };
  chrome.scripting.executeScript({ target: { tabId }, func: showBanner, args: [payload] }).catch(() => {});
}

function showBanner(payload) {
  if (document.getElementById('fishcatcher-banner')) return;
  const colors = { high: '#fb923c', critical: '#f87171' };
  const root = document.createElement('div');
  root.id = 'fishcatcher-banner';
  root.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0b1d2e;color:#e8f1f8;border-bottom:2px solid ${colors[payload.level]};font:13px/1.5 system-ui,sans-serif;padding:10px 14px;display:flex;gap:12px;align-items:flex-start;`;
  const main = document.createElement('div');
  main.style.cssText = 'flex:1;min-width:0';
  const title = document.createElement('strong');
  title.textContent = `FishCatcher — ${payload.title}`;
  main.appendChild(title);
  const domain = document.createElement('div');
  domain.style.cssText = 'color:#2dd4bf;font-family:monospace;font-size:12px';
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
  btn.style.cssText = 'background:#122a40;color:#e8f1f8;border:1px solid #1d3a54;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit';
  btn.addEventListener('click', () => {
    root.remove();
    chrome.runtime.sendMessage({ type: 'banner-dismissed', url: location.href });
  });
  root.appendChild(main);
  root.appendChild(btn);
  document.documentElement.appendChild(root);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) scoreTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab?.url) scoreTab(tabId, tab.url);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => results.delete(tabId));

async function setTrust(domain, trusted) {
  await ready;
  if (trusted) data.trustList.add(domain);
  else data.trustList.delete(domain);
  await chrome.storage.local.set({ 'trust:list': JSON.stringify([...data.trustList]) });
  for (const [tabId, result] of [...results]) {
    if (result.registrable === domain) scoreTab(tabId, result.url);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    switch (msg.type) {
      case 'get-result':
        sendResponse({ result: results.get(msg.tabId) ?? null });
        break;
      case 'rescore': {
        const tab = await chrome.tabs.get(msg.tabId);
        if (tab?.url) await scoreTab(msg.tabId, tab.url);
        sendResponse({ result: results.get(msg.tabId) ?? null });
        break;
      }
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
    }
  })();
  return true; // respond asynchronously
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['opt:remote'] || changes['opt:remoteUrl']) loadRemoteLists();
});

// Chromium-only: keyboard command opens the side panel.
// Firefox has no sidePanel API — its sidebar opens from the toolbar/view menu.
if (chrome.sidePanel) {
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === 'open_panel' && tab) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
}
