# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` (browser extension). Key files: `background.js`, `contentScript.js`, `translator.js`, `throttle.js`, `config.js`, `pdfViewer.html/js`.
- Tests: `test/` (Jest). Example: `translator.test.js`.
- Scripts: `scripts/convert-safari.sh` (Safari project generation), `set-config.js` (test config helper).
- Build artifacts/projects: `safari/` (converter output). PDFs and HTML fixtures for local testing live at repo root (e.g., `test-pdf.html`, `debug-pdf-viewer.html`).

## Build, Test, and Development Commands
- `npm test`: Runs Jest with jsdom and `jest-fetch-mock`.
- `npm run build:safari`: Generates Safari extension projects via `xcrun safari-web-extension-converter` into `safari/`.
- Load in Chrome: chrome://extensions → Developer mode → Load unpacked → select `src/`.
- Local PDF viewer: open `src/pdfViewer.html` (uses `config.local.js` when present).

## Coding Style & Naming Conventions
- Indentation: 2 spaces; prefer semicolons; trailing commas optional.
- Naming: camelCase for vars/functions (`qwenTranslate`), UpperCamelCase for constructors (none currently), kebab-case for branches.
- Modules: CommonJS in Node paths; browser globals in extension files; avoid introducing bundlers.
- Files: tests as `*.test.js` in `test/`; source files as `*.js` in `src/`.

## Testing Guidelines
- Framework: Jest (`testEnvironment: jsdom`). Mock network via `jest-fetch-mock`.
- Scope: add unit tests for new translator/throttle behavior; prefer deterministic tests (fake timers for rate-limits).
- Naming: mirror source name (e.g., `translator.test.js`). Run with `npm test` before PR.

## Commit & Pull Request Guidelines
- Commits: imperative, present tense (e.g., "Replace PDF text …"). Optional prefixes `feat:`, `fix:`, `chore:` are welcome when meaningful.
- PRs: clear description, linked issue, test plan, and screenshots/GIFs for UI changes (PDF viewer, content script). Note any config changes.

## Security & Configuration Tips
- Never commit API keys. `src/config.local.js` is gitignored; use it for local `pdfViewer.html`. Or run `set-config.js` in the extension popup console to seed `chrome.storage.sync`.
- Store secrets only in `chrome.storage.sync`. Avoid logging secrets; use `debug` flag for verbose logs.
