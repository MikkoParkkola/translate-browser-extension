# Repository Guidelines

Project renamed to **TRANSLATE! by Mikko** (formerly Qwen Translator Extension).

Popup header displays the product name beside the settings button.

## Project Structure & Module Organization
- Source: `src/` (browser extension). Key files: `background.js`, `contentScript.js`, `translator.js`, `throttle.js`, `config.js`, `pdfViewer.html/js`.
- Popup: `popup.html` loads `popup/home.html` and `popup/settings.html` (provider management).
- Providers: `src/providers/{qwen,dashscope,openai,deepl,google,openrouter,anthropic,mistral,ollama,macos}.js` (registered via `src/lib/providers.js`).
- Messaging: `src/lib/messaging.js` (Port + legacy sendMessage fallback).
- Logging: `src/lib/logger.js` (centralized logger with redaction).
- Translation Memory (TM): `src/lib/tm.js` (IndexedDB TTL/LRU + metrics).
- Detection: `src/lib/detect.js` (local heuristic; background also supports optional Google detection).
- Batch delimiter: `src/lib/batchDelim.js` (collision-resistant delimiters).
- Theme: `src/styles/apple.css` (neutral translucent theme with light/dark variants).
- Tests: `test/` (Jest). Example: `translator.test.js`.
- Scripts: `scripts/convert-safari.sh` (Safari project generation), `set-config.js` (test config helper).
- Build artifacts/projects: `safari/` (converter output). PDFs and HTML fixtures for local testing live at repo root (e.g., `test-pdf.html`, `debug-pdf-viewer.html`).
- Docs: `README.md`, `docs/PROVIDERS.md`.

## Build, Test, and Development Commands
- `npm install` once to fetch dependencies.
- `npx playwright install --with-deps chromium` once to install browsers and system libs for e2e tests.
- `npm test`: Runs Jest with jsdom and `jest-fetch-mock`.
- `npm run build`: Copies `src/` to `dist/` (web-accessible assets included).
- `npm run build:zip`: Produces a reproducible ZIP in `dist/`.
- `npm run serve`: Serves `dist/` on http://localhost:8080.
- `npm run build:safari`: Generates Safari extension projects via `xcrun safari-web-extension-converter` into `safari/`.
- Load in Chrome: chrome://extensions → Developer mode → Load unpacked → select `dist/`.
- CI: `.github/workflows/ci.yml` runs tests, builds dist/zip, uploads artifacts, and executes Playwright e2e smoke tests (Chromium) on push/PR.
- Local PDF viewer: open `src/pdfViewer.html` (uses `config.local.js` when present).

## Testing Guidelines
- Run `npm run lint` and `npm run format` before `npm test`.
- Framework: Jest (`testEnvironment: jsdom`). Mock network via `jest-fetch-mock`.
- Scope: translator/throttle/provider/messaging/TM; prefer deterministic tests (fake timers for rate-limits).
- Naming: mirror source name (e.g., `translator.test.js`). Run with `npm test` before PR.
- Covered areas:
  - Provider selection and failover; error normalization (401/403 non-retryable; 429/5xx retryable; Retry-After parsing).
  - Messaging Port streaming and AbortController cancel; detectLanguage via Port and fallback; background ping/status.
  - Translator streaming integration; batch read-through; TTL/LRU; in-memory LRU with normalization; mixed-language batching (auto-detect per text and language-clustered groups).
  - TM: TTL + LRU pruning; metrics (hits, misses, sets, evictionsTTL/LRU).
  - Logger redaction: Authorization/apiKey redaction in strings and nested objects.
  - Background icon status and context menu registration (`test/background.test.js`).
- Selection/DOM flows (`e2e/context-menu.spec.js`, `e2e/dom-translate.spec.js`, `e2e/translate-page.spec.js`, `e2e/streaming-cancel.spec.js`) run via `npm run test:e2e:web`; PDF compare (`e2e/pdf-compare.spec.js`) runs via `npm run test:e2e:pdf`. `npm run test:e2e` executes both suites. CI job `e2e-smoke` installs Chromium (`npx playwright install --with-deps chromium`), serves `dist/`, and runs the suites headless.

## Commit & Pull Request Guidelines
- Commits: imperative, present tense (e.g., "Replace PDF text …"). Optional prefixes `feat:`, `fix:`, `chore:` are welcome when meaningful.
- PRs: clear description, linked issue, test plan, and screenshots/GIFs for UI changes (PDF viewer, content script). Note any config changes.

## Definition of Done
- Implement features using test-driven development (write failing tests first).
- Update unit, integration, and end-to-end test automation.
- Maintain test automation coverage above 80% with a 95% target.
- Ensure all CI tests pass and local test automation succeeds.
- Run lint/format tools and audit dependencies before committing.
- Update AGENTS.md with feature descriptions, architecture notes, style guides, and coding conventions.
- Keep troubleshooting instructions and debug logging current.
- Document code and remove dead code.
- Ensure dashboards and statistics are up to date.
- Complete security review and implement recommendations.
- Complete architecture review and implement recommendations.
- Include architectural diagrams and document configuration changes for major features.
- Complete performance review and implement recommendations.
- For sensitive changes, document in-depth security and performance review reports with risk assessment and mitigation plans.
- Complete UX review and implement recommendations.
- Conduct cross-browser compatibility and accessibility checks.
- Complete legal review (IPRs/GDPR/License) and implement recommendations.
- Catch and log errors, handle recovery, and implement failbacks.
- Obtain explicit user approval for breaking changes or dropped functionality.
- for each PR that alters the functionality, bump the version number. For smaller changes, at least the minor version number; for really big changes, the major number.
- Verify changelog updates and confirm the version bump for functionality changes.
## Security & Configuration Tips
- Never commit API keys. `src/config.local.js` is gitignored; use it for local `pdfViewer.html`. Or run `set-config.js` in the extension popup console to seed `chrome.storage.sync`.
- Store secrets only in `chrome.storage.sync`. Avoid logging secrets; use `debug` flag for verbose logs.
- Background-only keys: content scripts never send/hold API keys; background injects keys for direct and Port flows.
- Separate detection key: `detectApiKey` (Google) is used only for language detection; translation uses provider keys.
- Provider-specific keys supported: `apiKeyDashScope`, `apiKeyOpenAI`, `apiKeyDeepL` (fallback to `apiKey` if unset). Background chooses the correct key per provider.
- Additional fields: per-provider `charLimit`, `requestLimit`, `tokenLimit`, `costPerInputToken`, `costPerOutputToken`, `weight` and `strategy` guide cost tracking and load balancing. Google translation also requires `projectId` and `location`, and `secondaryModel` enables quota fallback.
- Ensure `styles/apple.css` is listed in `web_accessible_resources` for content <link> fallback.

## Security Scans & Remediation
- CI runs `npm audit` and `gitleaks` to catch vulnerable dependencies and leaked secrets.
- If `npm audit` reports issues, upgrade or patch affected packages (`npm audit fix` or manual updates`).
- If `gitleaks` flags a secret, remove it, rotate the credential, and purge it from git history if needed.
- Merges require passing scans with no unresolved vulnerabilities or secrets.

## Current Product State
- Multi-provider translation
  - Providers: DashScope (Qwen), OpenAI, DeepL, OpenRouter, Anthropic/Claude, Mistral, Google, Ollama and macOS system translation via `lib/providers.js`.
  - Popup settings include preset buttons for OpenAI, DeepL, Ollama and macOS providers.
- Providers are no longer auto-registered; call `qwenProviders.initProviders()` before translating when using built-ins. `qwenProviders.isInitialized()` reports whether defaults are loaded and the translator now logs a warning if a translation is attempted before initialization. Custom providers can create isolated registries via `qwenProviders.createRegistry()` and register prior to initialization to override or augment the defaults.
 - Providers are no longer auto-registered; call `qwenProviders.initProviders()` or `qwenProviders.ensureProviders()` before translating when using built-ins. `qwenProviders.isInitialized()` reports whether defaults are loaded and the translator now logs a one-time warning if a translation is attempted before initialization. Pass `{ autoInit: true }` to translation calls to invoke `initProviders()` on demand. Custom providers can create isolated registries via `qwenProviders.createRegistry()` and register prior to initialization to override or augment the defaults.
  - Provider order (`providerOrder`) and per-provider endpoints configurable; failover implemented with per-provider `runWithRetry` + rate-limit. Providers may include a `throttle` config to tune request/token limits per backend, with optional per-context queues (e.g., `stream`) for finer control.
  - Default config assumes roughly 500k free characters for Google/DeepL and tracks spend via `costPerInputToken`/`costPerOutputToken`. Background selects providers above `requestThreshold` and uses per-provider weights to balance load across those with available quota.
  - Background pulls provider-specific keys from storage (`getProviderApiKeyFromStorage`) and injects them on both direct and Port paths.
- Messaging and streaming
  - Port-based background proxy with chunk relay and cancellation; legacy `sendMessage` fallback.
  - Popup loads `lib/messaging.js` to proxy tests/translation through background (prevents 401). `ensure-start` requests host permission, injects scripts, and starts translation.
  - Content flows propagate `providerOrder`, `endpoints`, and `detector` to translation calls to enable multi‑provider failover beyond the popup.
- Detection and batching
  - Auto-detect source via local heuristic; optional Google detection in background using `detectApiKey`.
  - Mixed-language batching: per-text detection and language-clustered requests for accuracy.
  - Skips translation when source language matches target to avoid redundant work.
- Caching / TM
  - TM (IndexedDB) with TTL/LRU and metrics; optional chrome.storage.sync/WebDAV/iCloud sync with user toggle and remote clear; warmed before batching; skips re-translation of hits and diagnostics panel shows hit/miss counts.
  - In-memory LRU with normalized keys (whitespace collapsed + NFC) limits memory and improves hit rate.
- PDF translation
  - Custom viewer (`src/pdfViewer.html/js`) intercepts top-level PDFs and can use provider `translateDocument` (Google, DeepL Pro) or a local WASM pipeline to render translated pages.
  - Viewer parses page layout and overlays editable translated text boxes aligned to original coordinates, with navigation controls.
  - MuPDF/PDFium WASM engines: The viewer prefers MuPDF when available. Engine assets live under `src/wasm/vendor/` and are exposed via `web_accessible_resources` in `manifest.json`. On first load, `ensureWasmAssets()` fetches any missing assets from trusted HTTPS sources and serves them via blob/data URLs when needed. `chooseEngine()` probes availability (MuPDF/PDFium/Overlay/Simple) and selects the best match, honoring `wasmEngine`/`wasmStrict` flags in storage. Debug logs (`DEBUG: engine assets`, `DEBUG: chooseEngine selected`) in the console confirm detection.
- UX and theming
- Apple HUD (`styles/apple.css`) for in-page status and popup; in-app Getting Started guide; tooltips across fields.
  - Popup settings window resizes to fit content; width recalculates on tab switches and TM refresh using `window.resizeTo`.
  - Provider presets (DashScope/OpenAI/DeepL/OpenRouter); provider-specific endpoints/keys/models; version/date shown in popup.
  - Provider configs can be duplicated in settings to quickly clone setups for additional models.
  - Glossary and tone presets editable in popup; translator applies substitutions and formal/casual/technical tone options.
  - Logging via `qwenLogger` with levels and collectors; popup debug output uses the logger.
  - Fetch strategy is centralized in `lib/fetchStrategy.js`; override with `qwenFetchStrategy.setChooser(fn)` for custom proxy/direct routing.
  - Browser action icon shows quota usage ring and status dot (green active, red error, gray idle); badge reflects active translations.
  - Context menu entries: "Translate selection", "Translate page", and "Enable auto-translate on this site".
  - Selection bubble is disabled by default; enabling it adds a manual translate button when text is selected.
  - Popup "Test settings" button runs connectivity and translation diagnostics and reports results.
  - Auto-translate only starts for the active tab; background tabs remain untouched until activated.
- Build/CI
  - Reproducible dist + zip; CI builds/tests and uploads artifacts on push/PR.
  - `publish.yml` signs each main-branch build with `CRX_PRIVATE_KEY`, emitting `qwen-translator-extension-<version>.zip` and a matching signed `.crx`.

## TODO / Next Steps
- Content multi-provider propagation
  - Pass `endpoints` and `providerOrder` from `contentScript.js` translate calls (translateNode/translateBatch/selection) so on-page flows use multi-provider failover (currently wired in popup).
  - Ensure `detector` is consistently passed from content config (popup already does).
- Cyberpunk UI polish
  - Extend popup styling coverage (all inputs/buttons) to guarantee consistent neon theme; keep reduced-motion consideration.
  - Light/dark toggle via theme variables.
  - E2E smoke tests (CI)
  - Added Playwright CI job (`e2e-smoke`) covering DOM flows and PDF compare.
  - DOM translation cancellation tests introduce a 300 ms delay between chunks so abort signals propagate reliably across browsers.
- Detection tuning
  - Add minimum-signal threshold for very short tokens to reduce misclassification; optional sensitivity setting.
- Observability
  - Optional background debug endpoint to expose TM/cache metrics; Advanced UI readout in popup.
  - Diagnostics popup displays real-time throttle usage, cache stats, TM hits, and translation status via `stats` messages.
  - Advanced control for in-memory LRU size (`QWEN_MEMCACHE_MAX`) with validation.
  - Popup diagnostics log each step at info level and content-script batch translations log start/finish for easier troubleshooting.
- Provider ecosystem
  - Add additional providers (Azure OpenAI, Anthropic/Claude) behind registry; extend error normalization tests accordingly.
- Typed interfaces
  - Basic TypeScript declarations live in `types/index.d.ts`; expand coverage to remaining modules.
- Release ops
  - Store submission assets and a short checklist (icons, screenshots, store text). Consider a canary channel for staged rollouts.
