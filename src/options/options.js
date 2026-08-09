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

async function init() {
  await applyI18n();
  const stored = await chrome.storage.local.get(['opt:strict', 'opt:remote', 'opt:remoteUrl', 'ui:lang']);

  $('strict').checked = !!stored['opt:strict'];
  $('remote').checked = !!stored['opt:remote'];
  $('remote-url').value = stored['opt:remoteUrl'] ?? '';
  $('lang').value = stored['ui:lang'] ?? 'auto';

  $('strict').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'opt:strict': e.target.checked });
  });
  $('remote').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'opt:remote': e.target.checked });
  });
  $('remote-url').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'opt:remoteUrl': e.target.value.trim() });
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
