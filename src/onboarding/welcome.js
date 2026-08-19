import { applyI18n, getMessage } from '../ui/i18n.js';

applyI18n();
getMessage('welcomeTitle').then((t) => { document.title = t; });

document.getElementById('open-settings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
