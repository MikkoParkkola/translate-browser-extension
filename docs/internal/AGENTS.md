inherit: true
override:
  - "Workflow"
  - "Definition of Done"
  - "Automation"

# Repository Guidelines

Project renamed to **TRANSLATE! by Mikko** (formerly Qwen Translator Extension).

Popup header displays the product name beside the settings button.

## Project Structure & Module Organization

- Source: `src/` (browser extension). Key files: `background.js`, `contentScript.js`, `translator.js`, `throttle.js`, `config.js`, `pdfViewer.html/js`.
- Popup: `popup.html` loads `popup/home.html` and `popup/settings.html` (provider management).
- Providers: `src/providers/{qwen,dashscope,openai,deepl,google,openrouter,anthropic,mistral,ollama,macos}.js` (registered via `src/lib/providers.js`).
- Messaging: `src/lib/messaging.js` (Port + legacy sendMessage fallback).
- Logging: `src/lib/logger.js` (centralized logger with redaction of Authorization, apiKey, and token fields).
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
- `npm run pr`: Automates PR creation. Requires `BRANCH_NAME` and `COMMIT_MESSAGE` env vars and an authenticated `gh` CLI. Optionals: `PR_TITLE`, `PR_BODY`, `BASE_BRANCH` (default `main`). Checks for merge conflicts before pushing, runs lint/format/tests, `npm audit`, and `gitleaks detect --no-git` (requires the `gitleaks` CLI), commits, pushes, opens a PR, and enables auto-merge.
- `npm run secrets`: Runs `gitleaks detect --no-git` using the bundled CLI to scan the working tree for secrets.

### PR Automation Usage

```bash
BRANCH_NAME=my-branch \
COMMIT_MESSAGE="chore: describe change" \
npm run pr
```

Environment variables:

- `BRANCH_NAME` (required): new branch name.
- `COMMIT_MESSAGE` (required): Conventional commit message.
- `PR_TITLE` (optional): PR title (defaults to `COMMIT_MESSAGE`).
- `PR_BODY` (optional): PR description.
- `BASE_BRANCH` (optional): target branch, defaults to `main`.
- `GITHUB_TOKEN`/`GH_TOKEN`: token for the GitHub CLI.

## Testing Guidelines

- Run `npm run lint` and `npm run format` before `npm test`.
- Framework: Jest (`testEnvironment: jsdom`). Mock network via `jest-fetch-mock`.
- Scope: translator/throttle/provider/messaging/TM; prefer deterministic tests (fake timers for rate-limits).
- Naming: mirror source name (e.g., `translator.test.js`). Run with `npm test` before PR.
- Covered areas:
  - Provider selection and failover; error normalization (401/403 non-retryable; 429/5xx retryable; Retry-After parsing).
  - Messaging Port streaming and AbortController cancel; detectLanguage via Port and fallback; background ping/status.
  - Translator streaming integration; batch read-through; TTL/LRU; in-memory LRU with normalization; mixed-language batching (auto-detect per text and language-clustered groups).
  - TM: TTL + LRU pruning; metrics (hits, misses, sets, evictionsTTL/LRU). Settings page shows stats and export/import controls instead of listing all TM entries.
  - Logger redaction: Authorization/apiKey redaction in strings and nested objects.
  - Background icon status and context menu registration (`test/background.test.js`).
- Selection/DOM flows (`e2e/context-menu.spec.js`, `e2e/dom-translate.spec.js`, `e2e/translate-page.spec.js`, `e2e/streaming-cancel.spec.js`) run via `npm run test:e2e:web`; PDF compare (`e2e/pdf-compare.spec.js`) runs via `npm run test:e2e:pdf`. `npm run test:e2e` executes both suites. CI job `e2e-smoke` installs Chromium (`npx playwright install --with-deps chromium`), serves `dist/`, and runs the suites headless.

## Commit & Pull Request Guidelines

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) in imperative present tense (`feat:`, `fix:`, `chore:`, `docs:` etc.).
- Every functional change must include a `changeset` entry created via `npx changeset`.
- PRs require a clear description, linked issue, test plan, and screenshots/GIFs for UI changes (PDF viewer, content script). Note any config changes.
- PRs use `.github/PULL_REQUEST_TEMPLATE.md` for standardized sections.

## Release Workflow

- Versioning and changelogs follow org policy: semantic-release or Changesets. This repository currently uses [Changesets](https://github.com/changesets/changesets).
- On merges to `main`, `.github/workflows/release.yml` runs `changesets/action@v1` to publish to npm and create a GitHub release.
- `release.yml` requires `GITHUB_TOKEN` and `NPM_TOKEN` secrets for publishing.

## Merge Queue

- A GitHub merge queue (via Bors) serializes merges to keep `main` green.
- Required checks: `lint`, `test`, and `coverage` must succeed before a PR enters the queue.
- Queue a PR with `bors r+`. Use `bors r-` to remove it or `bors retry` after fixing failures.
- Troubleshooting:
  - Verify the Bors GitHub App is installed and `bors.toml` exists on `main`.
  - Ensure the branch is up to date and all required checks are green.
  - If the queue is stuck, check Bors logs and repository permissions.

### Nightly Rebase

- A scheduled workflow rebases all open PRs nightly and can be triggered manually.
- PRs with merge conflicts are skipped and an automatic comment tags the author.
- Contributors must resolve conflicts promptly so PRs can re-enter the merge queue.
- The workflow rebases each branch onto the latest `main`; avoid merge commits and let the job keep your branch fresh.
- Contributor instructions are also in [README.md#nightly-rebase](README.md#nightly-rebase); both documents describe the same nightly rebase policy.

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
  - When a fixed source language is set, each string is still language-detected; strings detected as a different language are returned unchanged.
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
- Background auto-update: `background.js` calls `chrome.runtime.requestUpdateCheck` every 6 h, reloads on `onUpdateAvailable`, and `onInstalled` shows a notification with the new version.

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
- Home popup shows per-provider usage cards using metrics from the background script.
- Provider ecosystem
  - Add additional providers (Azure OpenAI, Anthropic/Claude) behind registry; extend error normalization tests accordingly.
- Typed interfaces
  - Basic declaration stubs live in `types/index.d.ts`; expand coverage to remaining modules as needed.
- Release ops
  - Store submission assets and a short checklist (icons, screenshots, store text). Consider a canary channel for staged rollouts.


---

## Model Rate Limits

Please be aware that all cloud-based models (including Codex, Claude, Gemini, etc.) are subject to rate limits. If a model becomes unresponsive, it is likely that it has hit a rate limit. These limits will reset after a certain period of time.

The only model not subject to rate limits is the locally-run Ollama.
## Product Vision (TRANSLATE! by Mikko)

- One‑click, privacy‑respecting, provider‑agnostic translation that “just works” across the whole web.
- Fast, resilient, and cost‑aware routing across multiple backends (DashScope/Qwen, OpenAI, DeepL, Google, etc.).
- Zero-hassle onboarding: no prompts if permissions and a working provider are already available.

## Design Principles

- Don’t block: degrade gracefully, stream progress, and recover automatically.
- No surprises: never re‑ask for permissions or keys if already granted/stored.
- Single source of truth: background owns state; popup/settings reflect it instantly.
- Safety first: secure key storage, redacted logs, structured‑cloneable messaging.
- Testable by default: deterministic units, thin adapters, Playwright e2e paths.

## UX Gap Analysis (Current → Target)

- Permissions: Per‑site prompts → Global host access with auto‑injection.
- Onboarding: Repeated wizard → Gate by apiKey present AND lastProviderOk; never auto‑show if OK.
- Error surface: Generic errors → Provider‑specific messages (status/code) and actionable hints.
- Settings sync: Stale until reload → Background cache invalidation on storage change.
- Visibility: No context → Header shows active provider/model and live status badge.

## Backlog (Now → Next)

1) Error clarity and recovery (Now)
   - Return provider error details from background (status/code). DONE
   - Popup error panel shows exact reason (auth/quota/rate-limit) with CTA.

2) Provider resilience (Next)
   - Circuit breaker per provider (backoff on 5xx/timeout).
   - Quota awareness and spillover before hard limit.

3) QA / CI
   - Playwright: popup→translate success, status badge updates, settings persist.
   - CI guard: fail on non‑cloneable background responses; eslint/prettier on PR.

4) UX polish
   - Strategy presets (Fastest/Cheapest/Balanced). DONE
   - Status badge (Online/Busy/Rate limited/Offline). DONE
   - Optional compact popup layout toggle.

5) Observability
   - Lightweight in‑extension diagnostics (last errors, provider health, cache/TM).

6) Roadmap later
   - Per‑site preferences, glossary/tone quick toggles, PDF engine selector in Settings.

## Definition of Done (DoD) Gap Assessment

Status vs DoD:
- TDD and failing tests first: PARTIAL — unit tests exist; bug‑first policy added; needs automation.
- Test automation coverage ≥ 80% (95% target): PARTIAL — coverage high in core, missing UX/e2e.
- CI passing locally/remote: PARTIAL — CI exists; tighten gates (contract/cloneable, CSP).
- Lint/format/audit before commit: PARTIAL — scripts exist; make required checks.
- Troubleshooting & debug logging current: PARTIAL — one‑click debug added; needs docs.
- Documentation/code/dead code removal: PARTIAL — docs OK; remove archives/unused modules.
- Dashboards/stats up to date: PARTIAL — basic stats; needs richer metrics.
- Security review + recs: PARTIAL — gitleaks in place; add threat model & CSP audit.
- Architecture review + recs: PARTIAL — guidelines added; add diagrams/ADRs.
- Performance review: PARTIAL — add budgets & profiling.
- Cross‑browser & accessibility checks: PARTIAL — add Edge/Firefox/Safari checklists & axe tests.
- Legal review (IPR/GDPR/License): PARTIAL — add dep license scan & privacy statement.
- Error handling, recovery, failbacks: PARTIAL — improved; add circuit breaker/quota spillover.
- Breaking change approval, version bump, changelog: PARTIAL — Changesets; enforce in CI.

## Backlog to Close DoD Gaps (Actionable)

1) Testing & Coverage
- Add coverage thresholds (global 80%, changed files 90%) in jest config; gate CI.
- Playwright e2e: popup→translate success; settings round‑trip; error flows (401/403/429/offline); PDF smoke.
- Contract test: assert structured‑cloneable background responses for all actions.
- Provider mocks: deterministic mock server for DashScope/OpenAI/DeepL (HTTP 200/401/403/429/5xx).
- Bug‑first harness: `npm run test:bug` template that scaffolds a failing spec from a report.

2) CI/CD Hardening
- Require checks: lint, format, unit (coverage gate), contract, e2e, audit, gitleaks.
- Build reproducibility check (hash diff) and manifest policy (has <all_urls>, CSP rules).
- Changesets enforced: block PR if version bump missing for functional change.

3) Security & Privacy
- Threat model doc; review secrets flow; ensure keys never enter content scope.
- CSP audit script to detect inline handlers; CI fail on violations.
- Dependency license scan (oss‑review‑toolkit or license‑checker) + privacy statement.

4) Architecture & Docs
- ADRs for provider abstraction, messaging schema, caching, error handling.
- Diagrams (C4): context, container, component for background/popup/content.
- Remove dead code (`.consolidation-archive`, unused scripts); add lint rule to disallow unused files.

5) Performance & Resilience
- Circuit breaker per provider; exponential backoff and cooldown windows.
- Quota‑aware spillover before hard limit; dynamic weights.
- Performance budgets: scan time per N nodes, translate latency p95, memory caps; CI asserts.

6) UX & Accessibility
- Status badge states mapped to exact remedies; richer error panel with CTA.
- Axe‑core accessibility tests for popup/options; keyboard navigation tests.
- Compact mode toggle; responsive checks at 320px/768px/1024px.

7) One‑Click Debug & Troubleshooting
- Finalize “Copy Debug Info” schema; add Settings → Diagnostics panel with copy/export.
- Issue template auto‑fills with pasted JSON; doc: how to capture logs and reproduce locally.

8) Cross‑Browser
- Edge/Firefox compatibility matrix (manifest nuances); Safari converter smoke; CI job that builds safari/.

Owners & Tracking
- Each backlog item must link to an issue and a PR checklist (tests, docs, changelog, rollout notes).

## Architecture Guidelines

- Layered boundaries: popup (UI) ↔ background (state/orchestration) ↔ content (page ops). Message schemas live in one place.
- Provider plug‑ins: each provider implements translate(), listModels() and optional getQuota(); wrapped with standardized error handler.
- Central config: providerStore (secrets + settings) is the single source of truth; cache invalidation on storage changes.
- Resilience: throttle + circuit breaker + retry/jitter; fail fast to next provider when unhealthy.
- Security: secure storage for secrets, redacted logs, structured‑cloneable messages only.

### Architecture Deep‑Dive

- Message Contracts
  - Define all background actions and payloads in a single schema file; versioned; validated on both ends.
  - Only structured‑cloneable types cross process boundaries; add CI guards.
- Provider Abstraction
  - Provider adapters return normalized results `{ text, confidence?, meta? }` and throw ProviderError(status, code).
  - Feature flags per provider (streaming, quota, detection) allow capabilities to degrade gracefully.
- Configuration Flow
  - Settings → providerStore → background cache invalidation → popup refresh via `home:init`.
  - Secrets never flow to content scripts; background injects only what’s safe.

## Coding Guidelines

- Prefer pure functions and narrow modules; hide side‑effects behind adapters.
- No inline event handlers (CSP). Use addEventListener only.
- Defensive APIs: validate/sanitize inputs; never throw from message boundaries.
- Log with context and redaction; include operation/module in every entry.
- Types: add JSDoc/TS typedefs for message payloads, provider config, and usage stats.

### Additional Coding Standards

- Keep functions < 50 LOC where practical; extract helpers.
- Feature flags behind `config` + environment guards; avoid dead code paths.
- Name things for behavior (e.g., `buildProvidersUsageSnapshot`) not implementation.
- Prefer async/await with try/catch around external calls; never swallow errors silently.

## CI/CD Guidelines

- Required checks: lint, unit, e2e (Chromium), build reproducibility, audit, gitleaks.
- Block PR on non‑cloneable response detection and CSP regressions (static check + e2e).
- Artifacts: upload dist zip + sourcemaps; tag with Changesets; generate changelog.
- Release: semantic versioning; rollback plan; keep signed artifacts.

### CI/CD Pipeline Details

1) Lint/Format: eslint (strict) + prettier; fail on warnings for touched files.
2) Unit: jest with jsdom; coverage gate ≥ 80%.
3) Contract Test: spawn background; send/receive every action; assert structured‑cloneable payloads.
4) E2E: Playwright (Chromium) – popup → translate success; settings round‑trip; error surfacing.
5) Build: reproducible dist with manifest checks; zip artifact hash diff.
6) Security: `npm audit --production` and `gitleaks detect --no-git`.
7) Release: Changesets version bump; GitHub Release with signed zip; publish to canary channel if enabled.

## Git & Merge Principles

- Conventional Commits (feat/fix/chore/docs/refactor/test).
- Small, focused PRs with a clear problem statement and test plan.
- Rebase/merge queue only when all required checks are green.
- Avoid force‑push on shared branches; maintain linear history for release branches.

### Commit/PR Hygiene

- Subject imperative, ≤ 72 chars; body explains the why; link issue.
- Include screenshots/GIFs for UI; include logs for bugfixes.
- Every fix adds/updates tests that fail before the fix and pass after.

## UX Design Principles

- Don’t ask twice: if permission or model is present and working, no re‑prompts.
- Clear status at a glance: active provider/model, service badge, and immediate next action.
- Progressive disclosure: advanced settings behind details; primary actions prominent.
- Accessibility: keyboardable UIs; color‑contrast; aria‑live for status changes.

### UX Testing Principles

- Heuristics: first‑run path must complete in ≤ 60s with minimal input.
- Error copy: informative, actionable, and non‑blocking; provide recovery (retry/change provider/open settings).
- Layout resilience: no overflow on 320px width; dark/light themes consistent.
- Keyboard flows: Tab order logical; Enter/Escape mapped where expected.

## UX Testing Principles

- Golden paths: first‑run setup with a valid key (no extra prompts), translate selection/page, and settings edit.
- Negative flows: invalid key, offline, rate‑limit; show actionable messages and recovery CTAs.
- Visual checks: status badge states, strategy buttons, provider editor save/test.

## Testing & Test Automation

- Unit: providers, error normalization, throttling, messaging validation (structured‑cloneable contract test).
- Integration: background resolveProviderSettings → handleTranslate happy/edge cases.
- E2E (Playwright): popup → translate (injected content), settings round‑trip, status updates.
- Performance: basic timings for batch operations; budget thresholds in CI.

### Test Strategy & Bug Policy

- Bug First Rule: when a user reports a bug, write an automated test that reproduces it (fail red) before any fix.
- Narrowing: add additional tests to pinpoint the exact failing layer and cover close variants.
- Only then fix; keep the failing tests; add a regression test if needed.
- CI must include the new test; PR must show red→green with the fix.

### One‑Click Debug Info (Testability by Design)

- Provide a “Copy Debug Info” button in error panels and Settings → Diagnostics to copy a redacted JSON blob including:
  - App/version; manifest; active provider/model; strategy; key presence (boolean only).
  - Last provider error `{ message, status, code }`; lastProviderOk flag; usage snapshot.
  - Recent background logs (sanitized); message action traces around failure.
- The blob must be structured and ready to paste into an AI‑assistant or issue template.

## Bug Investigation Playbook

1) Repro quickly: capture console logs (popup/background), network (provider call), and message payloads.
2) Classify: UX (CSP/DOM), messaging (schema/clone), provider (HTTP/auth/quota), resilience (retry/backoff), or permissions.
3) Isolate: write a focused unit/integration test that fails for the exact symptom.
4) Fix at the right layer: e.g., sanitize responses in dispatcher, normalize provider errors, or adjust config resolution.
5) Prevent regression: add a CI guard/e2e covering the scenario; link the test to the issue.

### Example Debug Flow

- User hits “Translation request failed” → clicks “Copy Debug Info” → pastes blob in issue.
- Dev runs `npm run test:bug -- -t "copy debug blob reproduces"` → failure shown.
- Add targeted unit test for provider error mapping; fix; PR shows failing test passes.
