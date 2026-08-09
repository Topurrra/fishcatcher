// FishCatcher background worker (M2).
// Engine functions (analyzeUrl, …) are bundled into this file by scripts/build.mjs —
// this source file intentionally has no import/export statements.

const LEVEL_COLORS = { low: '#34d399', elevated: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const BADGE_TEXT = { low: '', elevated: '!', high: '!!', critical: '!!!' };

const data = { safeList: new Set(), brands: [], tlds: {}, keywords: [], psl: [], trustList: new Set() };
const results = new Map();

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
}
const ready = loadData();

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
    }
  })();
  return true; // respond asynchronously
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
