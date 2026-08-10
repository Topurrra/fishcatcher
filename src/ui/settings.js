// Shared settings wiring, used by both the options page and the Chromium
// side panel. Binds controls by id in whatever document loads it.
import { getMessage } from './i18n.js';
import { UI_ICONS } from './icons.js';

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Reflect the threat-list update state so the user sees progress and results.
async function setRemoteStatus(state, info = {}) {
  const el = document.getElementById('remote-status');
  if (!el) return;
  if (state === 'off') {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `statusline is-${state}`;
  const icon = el.querySelector('.si-icon');
  const text = el.querySelector('.si-text');
  if (state === 'downloading') {
    icon.innerHTML = UI_ICONS.spinner;
    text.textContent = await getMessage('remoteUpdating');
  } else if (state === 'ready') {
    icon.innerHTML = UI_ICONS.check;
    const count = info.count != null ? Number(info.count).toLocaleString() : '?';
    text.textContent = await getMessage('remoteReady', [count, fmtDate(info.updatedAt)]);
  } else if (state === 'error') {
    icon.innerHTML = UI_ICONS.alert;
    text.textContent = await getMessage('remoteError');
  }
}

export async function renderTrustList() {
  const ul = document.getElementById('trust-list');
  if (!ul) return;
  const stored = await chrome.storage.local.get('trust:list');
  const list = stored['trust:list'] ? JSON.parse(stored['trust:list']) : [];
  const empty = document.getElementById('trust-empty');
  if (empty) empty.hidden = list.length > 0;
  ul.textContent = '';
  for (const domain of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'domain';
    span.textContent = domain;
    const btn = document.createElement('button');
    btn.textContent = await getMessage('removeTrust');
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'untrust', domain });
      renderTrustList();
    });
    li.append(span, btn);
    ul.appendChild(li);
  }
}

// Opt-in network features request their permissions at enable time.
async function requestOnEnable(checkbox, request) {
  if (!checkbox.checked) return true;
  const granted = await chrome.permissions.request(request);
  if (!granted) checkbox.checked = false;
  return granted;
}

export async function initSettings() {
  const $ = (id) => document.getElementById(id);
  const stored = await chrome.storage.local.get(['opt:strict', 'opt:remote', 'opt:cloud', 'opt:downloads', 'ui:lang']);

  $('strict').checked = !!stored['opt:strict'];
  $('remote').checked = !!stored['opt:remote'];
  $('cloud').checked = !!stored['opt:cloud'];
  $('downloads').checked = !!stored['opt:downloads'];
  $('lang').value = stored['ui:lang'] ?? 'auto';

  $('strict').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'opt:strict': e.target.checked });
  });
  // Updates always come from the fixed FishCatcher registry: opt in / out only.
  $('remote').addEventListener('change', async (e) => {
    if (!(await requestOnEnable(e.target, { origins: ['https://raw.githubusercontent.com/*'] }))) {
      setRemoteStatus('off');
      return;
    }
    chrome.storage.local.set({ 'opt:remote': e.target.checked });
    setRemoteStatus(e.target.checked ? 'downloading' : 'off');
  });
  $('cloud').addEventListener('change', async (e) => {
    if (!(await requestOnEnable(e.target, { origins: ['https://rdap.org/*', 'https://rdap.verisign.com/*'] }))) return;
    chrome.storage.local.set({ 'opt:cloud': e.target.checked });
  });
  $('downloads').addEventListener('change', async (e) => {
    if (!(await requestOnEnable(e.target, { permissions: ['downloads', 'notifications'] }))) return;
    chrome.storage.local.set({ 'opt:downloads': e.target.checked });
  });
  $('lang').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'ui:lang': e.target.value });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['trust:list']) renderTrustList();
  });

  // Reflect current update state, and listen for live progress from the worker.
  if (stored['opt:remote']) {
    const s = await chrome.storage.local.get(['remote:count', 'remote:updatedAt']);
    if (s['remote:updatedAt']) setRemoteStatus('ready', { count: s['remote:count'], updatedAt: s['remote:updatedAt'] });
    else setRemoteStatus('downloading');
  } else {
    setRemoteStatus('off');
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'remote-status') setRemoteStatus(msg.state, msg);
  });

  await renderTrustList();
}
