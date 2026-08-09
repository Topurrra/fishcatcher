// FishCatcher background worker.
// M0 scaffold — the URL scoring engine lands in M1.

chrome.runtime.onInstalled.addListener(() => {
  console.log('FishCatcher installed (M0 scaffold)');
});

// Chromium-only: keyboard command opens the side panel.
// Firefox has no sidePanel API — its sidebar opens from the toolbar/view menu.
if (chrome.sidePanel) {
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === 'open_panel' && tab) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
}
