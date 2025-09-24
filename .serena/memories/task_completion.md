# Task Completion Checklist
1. Run `npm run lint` and address warnings; follow with `npm run format` (or Prettier `--write`) so CI passes style checks.
2. Execute `npm test` to keep Jest coverage ≥80%; add/adjust specs (bug-first) and update snapshots/fakes as required.
3. For UI, DOM, or PDF changes, run the relevant Playwright suites (`npm run test:e2e:web`, `npm run test:e2e:pdf`, or combined `npm run test:e2e`) after installing browsers via `npx playwright install --with-deps chromium`.
4. Rebuild artifacts with `npm run build` (plus `npm run build:zip` if packaging) and verify the extension/popup manually; regenerate Safari output when affecting Safari-specific code.
5. Ensure bundle budgets and security gates pass: `npm run size`, `npm audit` (or `npm audit fix` if safe), and `npm run secrets` for gitleaks.
6. Update documentation/AGENTS/architecture notes, changelog/Changeset entries, and diagnostics docs when workflows or behaviours change; include diagrams or screenshots for UX-affecting work.
7. Prepare Conventional Commit messages, create a Changeset for functional changes (version bump policy), and complete the PR template with test plan and artifacts; optionally use `npm run pr` to automate checks/push.
8. Confirm no secrets or sensitive logs are introduced, structured messaging remains cloneable, and background owns new state transitions before requesting review.
