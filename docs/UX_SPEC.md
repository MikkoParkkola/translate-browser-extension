# TRANSLATE! by Mikko — UX/UI Specification

## Vision
One‑click, reliable, and unobtrusive translation with clear status, zero redundant prompts, and fast recovery.

## Primary UI (Popup)
- Header
  - Product: name/version (implicit)
  - Active provider/model: `#activeProvider` · `#activeModel` (data-test: `active-provider`, `active-model`)
  - Status badge: `#status-badge` (Online / Busy / Rate limited / Offline)
  - Copy Debug: `#copy-debug` (copies redacted JSON)
- Language selectors: from/to, swap button
- Strategy presets: Fastest / Cheapest / Balanced (ids: `strategy-fast/cheap/balanced`)
- Error panel: `#error-panel` (hidden by default)
  - Message: `#error-message`, detail `#error-detail`
  - Actions: Retry, Switch to Cheapest, Edit Provider

## Settings (popup/settings.html)
- Qwen presets + Test button; provider list with Edit (✎)
- Provider Editor overlay: key/endpoint/model + advanced fields

## Behaviors
- Global permissions: no site prompts; background auto-injects content script.
- Onboarding: only if no key AND lastProviderOk=false.
- Status badge reflects usage; error panel shows provider error details and recovery CTAs.
- Copy Debug includes: app/version, provider/model/status, usage snapshot, config (no secrets), lastProviderOk, last error.

## Accessibility
- Keyboardable; aria-live for status and errors; contrast ≥ AA.

## Acceptance Tests (High Level)
1) Popup loads → shows provider/model and Online status (with stubbed background responses).
2) Strategy buttons exist and persist order in Settings.
3) Error panel appears on simulated error with actions visible.
4) Copy Debug copies JSON containing required keys.
5) Settings loads without CSP inline-event errors; Edit opens editor.

