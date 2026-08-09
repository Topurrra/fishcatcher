// Applies chrome.i18n messages to every element carrying data-i18n="<messageName>".
export function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    const msg = chrome.i18n?.getMessage(key);
    if (msg) el.textContent = msg;
  }
}
