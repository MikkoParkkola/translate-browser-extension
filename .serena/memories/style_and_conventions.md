# Style & Conventions
- Follow `AGENTS.md`: background is the single source of truth; popup/settings reflect state instantly; prefer pure functions and isolate side-effects behind adapters.
- Messaging must stay structured-cloneable; validate payloads (zod schemas) and return typed errors instead of throwing across context boundaries; never leak secrets (logger auto-redacts Authorization/apiKey/token fields).
- Provider adapters return `{ text, confidence?, meta? }`, implement retry/throttle/circuit-breaker patterns, and surface granular status codes for diagnostics; translation flows batch DOM updates, skip no-op language matches, and sync with translation memory.
- Coding style enforced by ESLint: 2-space indent, single quotes, semicolons, trailing commas on multiline structures, prefer `const`, avoid `var`, security-focused rules (`no-implied-eval`, `no-script-url`), allow `console` for extension logging but warn on `debugger`.
- Keep modules < ~50 LOC when practical, extract helpers for clarity, and document tricky logic with succinct comments (avoid noise comments).
- Commit policy: Conventional Commits (imperative present), include Changeset for functional changes, attach screenshots/GIFs for UI updates, and update AGENTS/docs when architecture/UX shifts.
- Tests: bug-first workflow (write failing spec), deterministic Jest tests (fake timers/fetch mocks), ensure Playwright suites cover popup/DOM/PDF changes; maintain coverage ≥80% (goal 95%).
- CSS/theming: reuse `styles/apple.css` Apple HUD aesthetic, maintain accessible focus states, respect reduced-motion preferences, and ensure popup layout works from 320px upward.
