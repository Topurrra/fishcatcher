// Thin wrapper over chrome.i18n. Works in pages, content scripts and the
// bundled background worker (no DOM use outside applyI18n). Messages use $1..$9
// directly in their text, which chrome.i18n.getMessage substitutes positionally.
// Async on purpose: every caller awaits or .then()s it, as they did with the old loader.
export async function getMessage(key, params) {
  return chrome.i18n.getMessage(key, (params ?? []).map(String));
}

export async function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] || 'en';
}
