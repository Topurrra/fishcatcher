# FishCatcher Roadmap

Deferred work — not committed to, parked here on purpose.

## Deferred features

| Item | Notes |
|---|---|
| Right-click "Check this link" | Needs `contextMenus` permission; permission removed in M4 to keep the manifest minimal for store review. Re-add permission + menu + link-result view in panel when picked up. |
| Google Safe Browsing API | Opt-in, disclosed in-product; free tier. Plan §10. |
| PhishTank / community feeds | Delivered through the existing remote-update channel. |
| Warning history & stats | "What you learned" view; educational angle. |
| Signed update bundles + hosted endpoint | For the remote-update channel at scale. |
| Edge / Opera packaging | Same Chromium build; mostly store paperwork. |
| In-product education module | "Phishing school" mini-lessons, rotating tips in popup. |
| Real icon art + promo tiles | Current icons are generated placeholders; store promo assets are a manual design step. |
| Visual similarity / on-device ML | Friend review (FR_IDEA.txt) suggests logo/visual similarity checks; needs research + model size budget vs. MV3 lightweightness. |
| WHOIS / domain-age signals | Needs network; only as strictly opt-in cloud reputation check, clearly labeled. |
| AiTM proxy detection | Reverse-proxy phishing kits; hard offline — research item. |
| Auto-scan all page/email images for QR | Infeasible offline: cross-origin canvas taint + fetching every image needs broad host permissions. Right-click single-image check (M5d) is the privacy-compatible version. |
