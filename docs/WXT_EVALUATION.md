# WXT Framework Evaluation

## Summary

**Verdict: Defer migration.** WXT is maturing quickly and would bring meaningful DX improvements, but the migration cost outweighs the current benefits given the codebase already has a well-tuned Vite setup.

---

## Current Stack

| Concern | Current solution |
|---|---|
| Build orchestration | Raw Vite (5 config files) |
| Content-script bundling | Separate IIFE config (`vite.content.config.ts`) |
| Manifest management | Static `src/manifest.json`, copied at build time |
| Firefox port | Separate Firefox Vite config + manifest override |
| PDF worker | Third Vite config (`vite.pdfjs.config.ts`) |
| Dev server / HMR | Not available for extensions |
| Cross-browser polyfills | Hand-rolled `browserAPI` proxy in `core/browser-api.ts` |

This results in **5 separate Vite configs** and a build command that chains them manually.

---

## What WXT Provides

[WXT](https://wxt.dev) is a Vite-based framework specifically for browser extensions.

### DX wins
- **Single config file** for all entry points (popup, options, background, content, offscreen…). WXT auto-discovers files in `src/entrypoints/`.
- **First-class HMR** for popup/options pages during development.
- **Manifest auto-generation** from `wxt.config.ts` with per-environment overrides (Chrome / Firefox / Safari). Eliminates `manifest.json` drift.
- **`browser` polyfill** bundled automatically (uses `webextension-polyfill` under the hood), removing the need for the hand-rolled `browserAPI` proxy.
- **Built-in zip/publish** commands (`wxt zip`, `wxt submit`).
- **TypeScript-first** with generated types for `browser.*` APIs.

### Ecosystem maturity (as of 2025)
- v0.19+ stable; used in production by several popular extensions.
- Active maintenance; Vite 5 + 6 support.
- ~7k GitHub stars; good community.

---

## Migration Cost Estimate

| Task | Effort |
|---|---|
| Rename/restructure `src/` to `src/entrypoints/` convention | Medium |
| Replace 5 Vite configs with one `wxt.config.ts` | Medium |
| Remove `core/browser-api.ts` Proxy; replace with `browser.*` from WXT | High — ~60 call sites across 30+ files |
| Update test mocks (`browserAPI` → `browser`) | Medium |
| Verify offscreen document + WASM asset copy hooks | Low |
| Verify Safari / Firefox builds | Low |
| Update CI scripts | Low |

Total: **~2–3 days** of focused migration work.

---

## Recommendation

**Do not migrate now.** The current Vite setup works well, all tests pass, and the multi-config approach is understood by the team. Revisit when:
1. WXT reaches v1.0 stable.
2. A Firefox or Safari build breaks due to manifest drift — WXT's auto-generation would pay off immediately there.
3. A new developer joins and struggles with the multi-config setup (WXT's convention-over-config is friendlier to onboard).

**Low-hanging fruit to adopt without full migration:**
- Replace the hand-rolled `browserAPI` proxy with `webextension-polyfill` directly — this is what WXT wraps anyway, and it would reduce the `browserAPI` maintenance surface.
- Consider adding `wxt` as a dev dependency to use only its `zip`/`submit` CLI without adopting its build pipeline.
