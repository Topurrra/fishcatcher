import { applyI18n, getMessage } from '../ui/i18n.js';
import { STATUS_ICONS, UI_ICONS } from '../ui/icons.js';

const LEVEL_LABEL = {
  low: 'levelLow',
  elevated: 'levelElevated',
  high: 'levelHigh',
  critical: 'levelCritical'
};

const $ = (id) => document.getElementById(id);
let currentTabId;

async function render() {
  await applyI18n();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const { result } = await chrome.runtime.sendMessage({ type: 'get-result', tabId: currentTabId });

  if (!result) {
    document.body.className = '';
    $('status-label').textContent = await getMessage('noCheck');
    $('domain').hidden = true;
    $('reasons-wrap').hidden = true;
    $('trust-btn').hidden = true;
    return;
  }

  document.body.className = `level-${result.level}`;
  $('status-label').textContent = await getMessage(LEVEL_LABEL[result.level]);

  $('domain').hidden = false;
  $('domain').textContent = result.registrable;

  const list = $('reasons');
  list.textContent = '';
  for (const reason of result.reasons) {
    const li = document.createElement('li');
    li.textContent = await getMessage(reason.key, reason.params.map(String));
    list.appendChild(li);
  }
  $('reasons-wrap').hidden = result.reasons.length === 0;

  const trustBtn = $('trust-btn');
  if (result.level === 'low' && !result.trusted) {
    trustBtn.hidden = true;
  } else {
    trustBtn.hidden = false;
    trustBtn.textContent = await getMessage(result.trusted ? 'untrustButton' : 'trustButton');
    trustBtn.dataset.domain = result.registrable;
    trustBtn.dataset.trusted = result.trusted ? '1' : '';
  }
}

async function flashNote(key, params) {
  const el = $('action-note');
  el.querySelector('.si-icon').innerHTML = UI_ICONS.check;
  el.querySelector('.si-text').textContent = await getMessage(key, params);
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2600);
}

$('trust-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const untrusting = !!btn.dataset.trusted;
  const domain = btn.dataset.domain;
  await chrome.runtime.sendMessage({ type: untrusting ? 'untrust' : 'trust', domain });
  await chrome.runtime.sendMessage({ type: 'rescore', tabId: currentTabId });
  await render();
  flashNote(untrusting ? 'untrustConfirm' : 'trustConfirm', [domain]);
});

$('recheck-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${UI_ICONS.spinner}<span>${await getMessage('checkingLabel')}</span>`;
  await chrome.runtime.sendMessage({ type: 'rescore', tabId: currentTabId });
  await render();
  btn.innerHTML = original;
  btn.disabled = false;
});

// Firefox settings live on the options page (about:addons buries it); open it in a tab.
$('open-options-btn').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'scored') render();
});

render();
