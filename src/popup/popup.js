import { applyI18n } from '../ui/i18n.js';

const LEVEL_LABEL = {
  low: 'levelLow',
  elevated: 'levelElevated',
  high: 'levelHigh',
  critical: 'levelCritical'
};

const $ = (id) => document.getElementById(id);
let currentTabId;

async function render() {
  applyI18n();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const { result } = await chrome.runtime.sendMessage({ type: 'get-result', tabId: currentTabId });

  if (!result) {
    $('status').className = 'status level-low';
    $('status-label').textContent = chrome.i18n.getMessage('noCheck');
    $('domain').hidden = true;
    $('reasons-wrap').hidden = true;
    $('trust-btn').hidden = true;
    return;
  }

  $('status').className = `status level-${result.level}`;
  $('status-label').textContent = chrome.i18n.getMessage(LEVEL_LABEL[result.level]);

  $('domain').hidden = false;
  $('domain').textContent = result.registrable;

  const list = $('reasons');
  list.textContent = '';
  for (const reason of result.reasons) {
    const li = document.createElement('li');
    li.textContent = chrome.i18n.getMessage(reason.key, reason.params.map(String));
    list.appendChild(li);
  }
  $('reasons-wrap').hidden = result.reasons.length === 0;

  const trustBtn = $('trust-btn');
  if (result.level === 'low') {
    trustBtn.hidden = true;
  } else {
    trustBtn.hidden = false;
    trustBtn.textContent = chrome.i18n.getMessage(result.trusted ? 'untrustButton' : 'trustButton');
    trustBtn.dataset.domain = result.registrable;
    trustBtn.dataset.trusted = result.trusted ? '1' : '';
  }
}

$('trust-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  await chrome.runtime.sendMessage({
    type: btn.dataset.trusted ? 'untrust' : 'trust',
    domain: btn.dataset.domain
  });
  await chrome.runtime.sendMessage({ type: 'rescore', tabId: currentTabId });
  render();
});

$('recheck-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'rescore', tabId: currentTabId });
  render();
});

render();
