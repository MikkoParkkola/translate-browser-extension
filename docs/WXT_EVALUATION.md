# WXT Framework Evaluation

Last validated: 2026-05-12 against `wxt@0.20.26` (`npm latest`, GitHub tag `wxt-v0.20.26`).

## Summary

**Verdict: Defer migration.** WXT is maturing quickly and would bring meaningful DX improvements, but the migration cost outweighs the current benefits given the codebase already has a well-tuned Vite setup.

---

## Current Stack

| Concern | Current solution |
|---|---|
| Build orchestration | Raw Vite (4 build configs plus `vite.shared.ts`) |
| Content-script bundling | Separate IIFE config (`vite.content.config.ts`) |
| Manifest management | Static `src/manifest.json`, copied at build time |
| Firefox port | Separate Firefox Vite config + manifest override |
| PDF worker | Third Vite config (`vite.pdfjs.config.ts`) |
| Dev server / HMR | Not available for extensions |
| Cross-browser polyfills | Hand-rolled `browserAPI` proxy in `core/browser-api.ts` |

This results in **4 Vite build configs plus shared Vite config code** and a build command that chains Chrome, PDF worker, and content-script builds manually.

---

## What WXT Provides

[WXT](https://wxt.dev) is a Vite-based framework specifically for browser extensions.

### DX wins
- **Single WXT config file** for extension build concerns, with entrypoint files in `entrypoints/` or `src/entrypoints/`.
- **File-based entrypoints** for popup, options, background, content, and related extension surfaces.
- **First-class dev mode/HMR** for UI pages, plus reload support for content/background scripts.
- **Manifest auto-generation** from `wxt.config.ts` with per-environment overrides (Chrome / Firefox / Safari). Eliminates `manifest.json` drift.
- **Unified `browser` API export** from `wxt/browser`, removing most need for the hand-rolled `browserAPI` proxy. In v0.20 this is no longer `webextension-polyfill` by default; use `@wxt-dev/webextension-polyfill` if promise-style `onMessage` response behavior is required.
- **Built-in zip/publish** commands (`wxt zip`, `wxt submit`).
- **TypeScript-first** with WXT `Browser` namespace types for extension APIs.

### Ecosystem maturity (validated 2026-05-12)
- Current release: `wxt@0.20.26`, published as GitHub release `wxt-v0.20.26` on 2026-05-11.
- WXT is still pre-1.0. The upstream upgrade guide states `v0.X` bumps can carry breaking changes, and v0.20 is intended as a release candidate for v1.0.
- Active maintenance: latest release includes manifest generation fixes, Safari options UI fixes, content-script options, and Chrome Web Store submission dependency updates.
- Current package metadata supports Vite `^5.4.19 || ^6.3.4 || ^7.0.0 || ^8.0.0-0`, Node `>=20.12.0`, and ESLint `^8.57.0 || ^9.0.0 || ^10.0.0`.
- Community size has grown from the old snapshot: GitHub reports roughly 9.8k stars on 2026-05-12.

---

## Version-Specific Claim Validation

| Claim from prior evaluation | 2026-05-12 status | Notes |
|---|---|---|
| Current repo uses 5 Vite configs. | Still directionally valid, wording updated. | The repo has 4 Vite build config files (`vite.config.ts`, `vite.content.config.ts`, `vite.config.firefox.ts`, `vite.pdfjs.config.ts`) plus `vite.shared.ts`; build scripts still chain multiple Vite invocations. |
| WXT is Vite-based. | Still valid. | WXT uses Vite under the hood and exposes Vite customization through `wxt.config.ts`. |
| WXT auto-discovers entrypoints under `src/entrypoints/`. | Still valid. | WXT supports `srcDir: 'src'` and an `entrypoints/` directory under that source directory. |
| WXT provides first-class HMR for extension development. | Still valid. | Current docs advertise HMR for UI and fast reloads for content/background scripts. |
| WXT generates manifests from `wxt.config.ts` and entrypoints. | Still valid. | Current manifest docs state source projects do not keep a manifest file; WXT outputs generated manifests at build time. |
| WXT handles Chrome / Firefox / Safari manifest targets. | Still valid. | Current docs support browser targets and MV2/MV3 flags; defaults are MV2 for Firefox/Safari and MV3 for other browsers. |
| WXT bundles `webextension-polyfill` automatically. | Outdated. | v0.20 removed default `webextension-polyfill`; WXT now exports `browser` via `@wxt-dev/browser`, with the polyfill available through an optional module. |
| WXT provides `wxt zip` / `wxt submit`. | Still valid. | Current publishing docs describe `wxt zip`, `wxt submit init`, and `wxt submit`. |
| WXT has generated/type-safe browser API types. | Still valid with caveat. | Current docs expose the WXT `Browser` namespace, but warn that types do not guarantee API availability at runtime. |
| "v0.19+ stable; Vite 5 + 6 support; ~7k stars" | Outdated snapshot. | Current latest is `0.20.26`, still pre-1.0, with Vite 5/6/7/8 prerelease support metadata and roughly 9.8k GitHub stars. |

---

## Migration Cost Estimate

| Task | Effort |
|---|---|
| Rename/restructure `src/` to `src/entrypoints/` convention | Medium |
| Replace 4 Vite build configs plus shared Vite module with one `wxt.config.ts` | Medium |
| Remove `core/browser-api.ts` Proxy; replace with `browser.*` from WXT | High - many call sites across content, popup, offscreen, background, tests, and core modules |
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
- Replace the hand-rolled `browserAPI` proxy with either WXT's standalone `@wxt-dev/browser` style API or `webextension-polyfill` directly, depending on whether the project still relies on promise-returning `runtime.onMessage` listeners.
- Consider adding `wxt` as a dev dependency to use only its `zip`/`submit` CLI without adopting its build pipeline.

No new decision issue is needed from this review: the evaluation outcome remains "defer full migration".
