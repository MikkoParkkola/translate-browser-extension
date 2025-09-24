# Tech Stack
- **Languages & runtime**: JavaScript (CommonJS modules) targeting Chromium-based browsers and Safari (via converter); popup/settings use HTML/CSS with `styles/apple.css`; structured messaging between popup/content/background.
- **Key libraries**: `pdfjs-dist` and `mupdf` for PDF handling, `zod` for schema validation, `jest`/`jest-fetch-mock` for testing, `@playwright/test` for e2e, `size-limit` for bundle budgets, `copyfiles`/`rimraf` for build copies.
- **Tooling**:
  - Package manager: npm (lockfile present).
  - Build: `npm run build` copies `src` → `dist`; `npm run build:zip` wraps output; Safari conversion via `scripts/convert-safari.sh`.
  - Testing: Jest (`jest.config.js`, jsdom, coverage thresholds @ 80%); Playwright for DOM/PDF smoke tests; PDF comparison harness.
  - Lint/format: ESLint (`eslint.config.js`) with browser/Node globals + security rules, Prettier (targeted check) and size-limit enforcement.
  - Security/compliance: `gitleaks` CLI bundled; `npm audit`; Chrome signing workflow; Bors merge queue; Changesets for releases.
- **Supporting assets**: WASM engines in `src/wasm/vendor`, icons/i18n assets, type stubs in `types/`, CLI helpers under `cli/`.
