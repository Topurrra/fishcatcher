import { applyI18n, getMessage } from '../ui/i18n.js';

const $ = (id) => document.getElementById(id);

async function renderTrustList() {
  const stored = await chrome.storage.local.get('trust:list');
  const list = stored['trust:list'] ? JSON.parse(stored['trust:list']) : [];
  $('trust-empty').hidden = list.length > 0;
  const ul = $('trust-list');
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

// Opt-in network features request their host permissions at enable time,
// so the manifest stays quiet until the user explicitly opts in.
async function enableWithPermission(checkbox, origins) {
  if (!checkbox.checked) {
    return true;
  }
  const granted = await chrome.permissions.request({ origins });
  if (!granted) checkbox.checked = false;
  return granted;
}

async function init() {
  await applyI18n();
  const stored = await chrome.storage.local.get(['opt:strict', 'opt:remote', 'opt:remoteUrl', 'opt:cloud', 'opt:downloads', 'ui:lang']);

  $('strict').checked = !!stored['opt:strict'];
  $('remote').checked = !!stored['opt:remote'];
  $('remote-url').value = stored['opt:remoteUrl'] ?? '';
  $('cloud').checked = !!stored['opt:cloud'];
  $('downloads').checked = !!stored['opt:downloads'];
  $('lang').value = stored['ui:lang'] ?? 'auto';

  $('strict').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'opt:strict': e.target.checked });
  });
  $('remote').addEventListener('change', async (e) => {
    const url = $('remote-url').value.trim() || $('remote-url').placeholder;
    let origin;
    try {
      origin = new URL(url).origin + '/*';
    } catch {
      origin = 'https://raw.githubusercontent.com/*';
    }
    if (!(await enableWithPermission(e.target, [origin]))) return;
    chrome.storage.local.set({ 'opt:remote': e.target.checked });
  });
  $('remote-url').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'opt:remoteUrl': e.target.value.trim() });
  });
  $('cloud').addEventListener('change', async (e) => {
    if (!(await enableWithPermission(e.target, ['https://rdap.org/*', 'https://rdap.verisign.com/*']))) return;
    chrome.storage.local.set({ 'opt:cloud': e.target.checked });
  });
  $('downloads').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const granted = await chrome.permissions.request({ permissions: ['downloads', 'notifications'] });
      if (!granted) {
        e.target.checked = false;
        return;
      }
    }
    chrome.storage.local.set({ 'opt:downloads': e.target.checked });
  });
  $('lang').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'ui:lang': e.target.value });
  });

  await renderTrustList();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['trust:list']) renderTrustList();
});

init();
