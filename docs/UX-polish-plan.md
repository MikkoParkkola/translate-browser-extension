# TRANSLATE! by Mikko – MVP UX Polish Plan

This checklist captures the critical UI/UX refinements required to ship the MVP with a cohesive experience across popup, settings, and diagnostics surfaces. Items are grouped by surface area and map directly to backlog priorities.

## Popup Home
- Finalise top banner: confirm active provider/model badge updates on config changes and expose tooltip copy explaining failover behaviour.
- Theme toggle: match body `data-theme` attribute to Apple HUD palette (`styles/apple.css`) and ensure transition respects reduced-motion.
- Translate CTA: remove simultaneous `Translate Selection`/batch behaviour confusion by splitting into `Translate Selection` and `Translate Page` buttons with inline helper text; wire loading state to background status events.
- Auto-translate switch: surface per-tab status with explicit success/error messaging and disabled state when permissions missing.
- Diagnostics shortcut: replace `Copy Debug` text button with icon+label, add confirmation toast anchored to top-right.

## Settings Dialog
- Provider list: stabilise drag-and-drop reordering with keyboard support, show per-provider quota summary, and expose endpoint + model badges inline with the toggle.
- Editor modal: reorganise fields into Basics (endpoint, model, key), Advanced (limits, strategy), and Observability (cost, weight); persist endpoints map and reflect active provider order immediately.
- Global actions: align `Save`/`Test` buttons to bottom sticky footer with status pill; indicate last saved timestamp and storage target (sync vs local).
- Diagnostics panel: embed usage chart snapshot + TM stats, and provide `Copy Debug Info` consistent with popup.

## Accessibility & Responsiveness
- Audit focus order across popup/settings; add visible focus ring (2px, theme-aware).
- Ensure min width 320px layout without horizontal scroll; adjust stats grid to stack at narrow viewports.
- Announce background translation progress via `aria-live` with short, non-intrusive messages.

## Visual Polish
- Apply consistent spacing scale (8px grid) across sections; trim extra padding around alerts.
- Use shared badge component for status indicators (online, rate-limited, offline) with colorblind-safe palette.
- Introduce subtle card shadow/hover for provider entries while maintaining translucency aesthetic.

## QA & Instrumentation
- Add Playwright coverage for: theme toggle persistence, provider reorder drag/drop, auto-translate toggle transitions, diagnostics copy flow.
- Capture before/after screenshots (light/dark) for design review; document in `docs/UX-polish-plan.md` once implemented.

## Implementation Notes
- Centralise popup state in `popup.js` store; emit `config-changed` event to update badges without full reload.
- Reuse `lib/logger` for popup debug overlay; gate verbose logs behind `debug` flag.
- Ensure `window.resizeTo` only called when necessary to avoid jank; prefer CSS auto height where possible.

---
Tracking owners/tasks live in the project board; this doc serves as the definitive MVP UX checklist.
