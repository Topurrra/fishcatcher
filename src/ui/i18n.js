// Runtime i18n: loads _locales/<lang>/messages.json itself so the language can
// be overridden in options (ui:lang = auto | en | ka). Works in pages, content
// scripts and the bundled background worker (no DOM use outside applyI18n).
const cache = {};

async function loadMessages(lang) {
  if (!cache[lang]) {
    const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    cache[lang] = await res.json();
  }
  return cache[lang];
}

export async function currentLang() {
  // Language switching is disabled for now; the UI ships in English.
  return 'en';
}

export function format(template, params) {
  return template.replace(/\$(\d)/g, (_, i) => params?.[Number(i) - 1] ?? '');
}

export async function getMessage(key, params) {
  const messages = await loadMessages(await currentLang());
  const entry = messages[key];
  return entry ? format(entry.message, params) : '';
}

export async function applyI18n() {
  const lang = await currentLang();
  const messages = await loadMessages(lang);
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const entry = messages[el.dataset.i18n];
    if (entry) el.textContent = entry.message;
  }
  document.documentElement.lang = lang;
}
