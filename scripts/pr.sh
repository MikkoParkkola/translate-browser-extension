#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-main}"
BRANCH_NAME="${BRANCH_NAME:-}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-}"
PR_TITLE="${PR_TITLE:-}"
PR_BODY="${PR_BODY:-}"

if [[ -z "$BRANCH_NAME" ]]; then
  echo "BRANCH_NAME is required" >&2
  exit 1
fi

if [[ -z "$COMMIT_MESSAGE" ]]; then
  echo "COMMIT_MESSAGE is required" >&2
  exit 1
fi

# Ensure we're up to date and create branch
git fetch origin "$BASE_BRANCH"
git checkout -b "$BRANCH_NAME"

npm run lint
npm run format
npm test

# Commit changes
git add -A
git commit -m "$COMMIT_MESSAGE"

# Check for merge conflicts before pushing
if ! git merge --no-commit --no-ff "origin/$BASE_BRANCH"; then
  echo "Merge conflict detected with $BASE_BRANCH. Aborting." >&2
  git merge --abort || true
  exit 1
fi
git merge --abort || true

# Push and open PR with auto-merge
git push -u origin "$BRANCH_NAME"

gh pr create --base "$BASE_BRANCH" --head "$BRANCH_NAME" \
  --title "${PR_TITLE:-$COMMIT_MESSAGE}" --body "${PR_BODY:-}"

gh pr merge --auto --squash
