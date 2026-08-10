import { applyI18n } from '../ui/i18n.js';
import { initSettings } from '../ui/settings.js';

async function init() {
  await applyI18n();
  await initSettings();
}

init();
