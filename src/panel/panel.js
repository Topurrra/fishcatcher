import { applyI18n, getMessage } from '../ui/i18n.js';

const LEVEL_LABEL = {
  low: 'levelLow',
  elevated: 'levelElevated',
  high: 'levelHigh',
  critical: 'levelCritical'
};

const $ = (id) => document.getElementById(id);
let currentTabId;
let cameraStream = null;
let cameraTimer = null;

async function renderResult(result, noteKey) {
  await applyI18n();

  const note = $('note');
  if (noteKey) {
    note.hidden = false;
    note.textContent = await getMessage(noteKey);
  } else {
    note.hidden = true;
  }

  if (!result) {
    $('status').className = 'status level-low';
    $('status-label').textContent = await getMessage('noCheck');
    $('domain').hidden = true;
    $('reasons-wrap').hidden = true;
    $('hint').hidden = false;
    $('trust-btn').hidden = true;
    return;
  }

  $('status').className = `status level-${result.level}`;
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
  $('hint').hidden = result.reasons.length > 0 || !!noteKey;

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

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const { result } = await chrome.runtime.sendMessage({ type: 'get-result', tabId: currentTabId });
  renderResult(result, null);
}

// ── QR scanning (fully local) ───────────────────────────────────
async function decodeSource(source) {
  const bmp = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx2d = canvas.getContext('2d');
    ctx2d.drawImage(bmp, 0, 0);
    const img = ctx2d.getImageData(0, 0, bmp.width, bmp.height);
    return jsQR(img.data, img.width, img.height)?.data ?? null;
  } finally {
    bmp.close?.();
  }
}

async function showQrStatus(key) {
  const el = $('qr-status');
  el.hidden = false;
  el.textContent = await getMessage(key);
}

async function onQrDecoded(url) {
  stopCamera();
  const { result } = await chrome.runtime.sendMessage({ type: 'check-url', url });
  renderResult(result, 'qrResultNote');
}

function stopCamera() {
  if (cameraTimer) cancelAnimationFrame(cameraTimer);
  cameraTimer = null;
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  $('qr-video').hidden = true;
  $('qr-cam-btn').dataset.on = '';
}

$('qr-file-btn').addEventListener('click', () => $('qr-file').click());

$('qr-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const url = await decodeSource(file);
  if (url) onQrDecoded(url);
  else showQrStatus('qrNone');
});

$('qr-cam-btn').addEventListener('click', async () => {
  if (cameraStream) {
    stopCamera();
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    showQrStatus('qrNone');
    return;
  }
  const video = $('qr-video');
  video.hidden = false;
  video.srcObject = cameraStream;
  await video.play();
  $('qr-cam-btn').dataset.on = '1';
  $('qr-cam-btn').textContent = await getMessage('qrStop');

  let last = 0;
  const tick = async (t) => {
    if (!cameraStream) return;
    if (t - last > 300 && video.readyState >= 2) {
      last = t;
      try {
        const url = await decodeSource(video);
        if (url) return onQrDecoded(url);
      } catch {
        // frame not ready
      }
    }
    cameraTimer = requestAnimationFrame(tick);
  };
  cameraTimer = requestAnimationFrame(tick);
});

// ── wiring ──────────────────────────────────────────────────────
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'scored') render();
});

chrome.tabs.onActivated.addListener(() => render());

(async () => {
  const { result, note } = await chrome.runtime.sendMessage({ type: 'take-pending' });
  if (result) renderResult(result, note);
  else render();
})();
