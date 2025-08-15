# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` (browser extension). Key files: `background.js`, `contentScript.js`, `translator.js`, `throttle.js`, `config.js`, `pdfViewer.html/js`.
- Providers: `src/providers/{openai,deepl,dashscope}.js` (auto-registered via `src/lib/providers.js`).
- Messaging: `src/lib/messaging.js` (Port + legacy sendMessage fallback).
- Logging: `src/lib/logger.js` (centralized logger with redaction).
- Translation Memory (TM): `src/lib/tm.js` (IndexedDB TTL/LRU + metrics).
- Detection: `src/lib/detect.js` (local heuristic; background also supports optional Google detection).
- Batch delimiter: `src/lib/batchDelim.js` (collision-resistant delimiters).
- Theme: `src/styles/cyberpunk.css` (cyberpunk HUD + popup styling).
- Tests: `test/` (Jest). Example: `translator.test.js`.
- Scripts: `scripts/convert-safari.sh` (Safari project generation), `set-config.js` (test config helper).
- Build artifacts/projects: `safari/` (converter output). PDFs and HTML fixtures for local testing live at repo root (e.g., `test-pdf.html`, `debug-pdf-viewer.html`).
- Docs: `README.md`, `docs/PROVIDERS.md`.

## Build, Test, and Development Commands
- `npm test`: Runs Jest with jsdom and `jest-fetch-mock`.
- `npm run build`: Copies `src/` to `dist/` (web-accessible assets included).
- `npm run build:zip`: Produces a reproducible ZIP in `dist/`.
- `npm run serve`: Serves `dist/` on http://localhost:8080.
- `npm run build:safari`: Generates Safari extension projects via `xcrun safari-web-extension-converter` into `safari/`.
- Load in Chrome: chrome://extensions → Developer mode → Load unpacked → select `dist/`.
- CI: `.github/workflows/ci.yml` runs tests, builds dist/zip, and uploads artifacts on push/PR.
- Local PDF viewer: open `src/pdfViewer.html` (uses `config.local.js` when present).

## Testing Guidelines
- Framework: Jest (`testEnvironment: jsdom`). Mock network via `jest-fetch-mock`.
- Scope: translator/throttle/provider/messaging/TM; prefer deterministic tests (fake timers for rate-limits).
- Naming: mirror source name (e.g., `translator.test.js`). Run with `npm test` before PR.
- Covered areas:
  - Provider selection and failover; error normalization (401/403 non-retryable; 429/5xx retryable; Retry-After parsing).
  - Messaging Port streaming and AbortController cancel; detectLanguage via Port and fallback; background ping/status.
  - Translator streaming integration; batch read-through; TTL/LRU; in-memory LRU with normalization; mixed-language batching (auto-detect per text and language-clustered groups).
  - TM: TTL + LRU pruning; metrics (hits, misses, sets, evictionsTTL/LRU).
  - Logger redaction: Authorization/apiKey redaction in strings and nested objects.

## Commit & Pull Request Guidelines
- Commits: imperative, present tense (e.g., "Replace PDF text …"). Optional prefixes `feat:`, `fix:`, `chore:` are welcome when meaningful.
- PRs: clear description, linked issue, test plan, and screenshots/GIFs for UI changes (PDF viewer, content script). Note any config changes.

## Security & Configuration Tips
- Never commit API keys. `src/config.local.js` is gitignored; use it for local `pdfViewer.html`. Or run `set-config.js` in the extension popup console to seed `chrome.storage.sync`.
- Store secrets only in `chrome.storage.sync`. Avoid logging secrets; use `debug` flag for verbose logs.
- Background-only keys: content scripts never send/hold API keys; background injects keys for direct and Port flows.
- Separate detection key: `detectApiKey` (Google) is used only for language detection; translation uses provider keys.
- Provider-specific keys supported: `apiKeyDashScope`, `apiKeyOpenAI`, `apiKeyDeepL` (fallback to `apiKey` if unset). Background chooses the correct key per provider.
- Ensure `styles/cyberpunk.css` is listed in `web_accessible_resources` for content <link> fallback.

## Current Product State
- Multi-provider translation
  - Providers: DashScope (Qwen), OpenAI, DeepL via `lib/providers.js`.
  - Provider order (`providerOrder`) and per-provider endpoints configurable; failover implemented with per-provider `runWithRetry` + rate-limit.
  - Background pulls provider-specific keys from storage (`getProviderApiKeyFromStorage`) and injects them on both direct and Port paths.
- Messaging and streaming
  - Port-based background proxy with chunk relay and cancellation; legacy `sendMessage` fallback.
  - Popup loads `lib/messaging.js` to proxy tests/translation through background (prevents 401). `ensure-start` requests host permission, injects scripts, and starts translation.
- Detection and batching
  - Auto-detect source via local heuristic; optional Google detection in background using `detectApiKey`.
  - Mixed-language batching: per-text detection and language-clustered requests for accuracy.
- Caching / TM
  - TM (IndexedDB) with TTL/LRU and metrics; warmed before batching; skips re-translation of hits.
  - In-memory LRU with normalized keys (whitespace collapsed + NFC) limits memory and improves hit rate.
- UX and theming
  - Cyberpunk HUD (`styles/cyberpunk.css`) for in-page status and popup; in-app Getting Started guide; tooltips across fields.
  - Provider presets (DashScope/OpenAI/DeepL); provider-specific endpoints/keys/models; version/date shown in popup.
- Build/CI
  - Reproducible dist + zip; CI builds/tests and uploads artifacts on push/PR.

## TODO / Next Steps
- Content multi-provider propagation
  - Pass `endpoints` and `providerOrder` from `contentScript.js` translate calls (translateNode/translateBatch/selection) so on-page flows use multi-provider failover (currently wired in popup).
  - Ensure `detector` is consistently passed from content config (popup already does).
- Cyberpunk UI polish
  - Extend popup styling coverage (all inputs/buttons) to guarantee consistent neon theme; keep reduced-motion consideration.
  - Optional: compact layout mode; light/dark toggle via theme variables.
- E2E smoke tests (CI)
  - Playwright: enable Auto, translate a sample page, assert text updates without layout shift; streaming/cancel smoke.
- Detection tuning
  - Add minimum-signal threshold for very short tokens to reduce misclassification; optional sensitivity setting.
- Observability
  - Optional background debug endpoint to expose TM/cache metrics; Advanced UI readout in popup.
  - Advanced control for in-memory LRU size (`QWEN_MEMCACHE_MAX`) with validation.
- Provider ecosystem
  - Add additional providers (Azure OpenAI, Anthropic/Claude) behind registry; extend error normalization tests accordingly.
- Release ops
  - Store submission assets and a short checklist (icons, screenshots, store text). Consider a canary channel for staged rollouts.
