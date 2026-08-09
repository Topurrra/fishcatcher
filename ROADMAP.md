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
| Visual similarity (logo) checks | Lexical ML shipped in M7; visual/logo similarity still open — needs model size budget vs. MV3 lightweightness. |
| AiTM detection (M8 — planned) | Research done (`AiTM_MV3_Detection_Research_Brief_Qwen_2026-08-10.docx`). How it's implementable: **Signal #1 (primary)** — generalize the existing S13 probe from "password form" to identity-security interaction (username/password/OTP/MFA-approval/device-code/passkey-enrollment/SSO-setup fields and submit buttons), then compare claimed IdP/brand against the eTLD+1; on-demand via `activeTab` + `scripting`, optional host permissions requested narrowly for automatic coverage. **Signal #2 (corroboration)** — resource-origin graph anomaly (scripts/styles/iframes/forms/favicons unexpectedly collapsed under the suspicious eTLD+1) from DOM/performance graph — no `webRequest` needed. **Signal #3** — device-code/auth-flow bridge, gated by identity semantics (S14 already covers the text side). **Signal #4 (boost only)** — multi-artifact drift (CSP/HSTS/favicon/manifest). Hard rules from the brief: never alert on proxy presence alone (Zscaler/Netskope/ZTNA false positives), `passkey/mfa/sso` in a hostname is never a standalone warning, allowlist enterprise IdP aliases and clientless-ZTNA hostnames. |
| Auto-scan all page/email images for QR | Infeasible offline: cross-origin canvas taint + fetching every image needs broad host permissions. Right-click single-image check (M5d) is the privacy-compatible version. |
