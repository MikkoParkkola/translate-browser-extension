# Contributing

Thanks for your interest in contributing to TRANSLATE!

## Development Setup

```bash
git clone https://github.com/MikkoParkkola/translate-browser-extension.git
cd translate-browser-extension
npm install
npm test          # Run the full unit suite
npm run build     # Build extension to dist/
```

## Testing

- `npm test` — Run all unit tests (Vitest)
- `npm run test:coverage` — Run with coverage gates enforced from `vitest.config.ts`
- `npm run test:mutation` — Mutation testing (Stryker, core + providers)
- `npm run test:e2e` — E2E tests (Playwright, requires `npm run build` first)
- `npm run validate:ci` — Run the same lint/format/typecheck/unit-test contract used by CI
- `npm run validate:build` — Build the extension bundle and enforce size limits

### Test patterns

Tests live next to their source files (e.g., `glossary.test.ts` next to `glossary.ts`). Use `vi.mock()` for external dependencies. Coverage uses the V8 provider. For genuinely untestable code (browser-only APIs), use `/* v8 ignore start */` / `/* v8 ignore stop */`.

## Code Quality

- TypeScript strict mode
- ESLint + Prettier
- All innerHTML sanitized via `escapeHtml()`
- Import limits (`MAX_IMPORT_ENTRIES`) on user data
- Provider contract tests ensure interface conformance

## Architecture Overview

- `src/core/` — Translation engine, caching, glossary, language detection
- `src/providers/` — 10 translation providers (DeepL, OpenAI, etc.)
- `src/content/` — Content scripts (DOM translation, widget, subtitles, PDF)
- `src/background/` — Service worker / background script
- `src/popup/` — Popup UI (Solid.js)
- `src/options/` — Options page (Solid.js)
- `e2e/` — Playwright E2E tests

## Pull Requests

- All PRs must pass CI (lint, typecheck, test, build)
- Coverage must not decrease
- Add tests for new features
- Run `npm test` locally before pushing
